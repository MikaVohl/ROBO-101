"""Reactive pick-and-place: randomized scenes, measured poses and contact checks.

No trained policy or prescribed sequence of object poses. Only the arm motors
move blocks during sorting; adding/moving an object is an explicit scene edit.
"""

import mujoco
import numpy as np

from robo_101.arm_stacking import ArmStackingTask
from robo_101.gripper_task import CLOSED, OPEN, PALM_OFFSET, Segment

COLORS = ("mint", "amber", "coral")
SORT_BLOCKS = tuple(f"{color}_{suffix}" for suffix in ("block", "extra") for color in COLORS)
BINS = np.array([[0.12, -0.08, 0.070], [0.12, 0.08, 0.070], [0.12, 0.24, 0.070]])


class ArmSortingTask(ArmStackingTask):
    """Reuse the arm's Cartesian motor control with a feedback-driven state machine."""

    clearance = 0.34
    stall_timeout = 20.0

    def __init__(self, model, data, joints, seed):
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        super().__init__(model, data, joints)
        self.block_qpos = [model.joint(f"{name}_joint").qposadr[0] for name in SORT_BLOCKS]
        self.block_dofs = [model.joint(f"{name}_joint").dofadr[0] for name in SORT_BLOCKS]
        self.block_geoms = [model.geom(f"{name}_geom").id for name in SORT_BLOCKS]
        model.geom_contype[self.block_geoms] = 0
        model.geom_conaffinity[self.block_geoms] = 0
        self.pads = {model.geom(f"{side}_pad").id for side in ("left", "right")}
        self.active = set()
        self.parked = {}
        self.target = None
        self.sorted = self.retries = self.replans = self.added = 0
        self.phase = "Looking"
        self.since = data.time
        self.start = self.segments[0].start.copy()
        self.goal = self.start.copy()
        self.command_position = self.start.copy()
        self.opening = OPEN
        self.yaw = self.start_yaw = self.goal_yaw = 0.0
        self.duration = 0.5
        self.retry_after = {}
        self.source = np.zeros(3)
        self.carry_offset = np.zeros(3)
        self.empty_since = None
        self.batch = 1
        self.last_progress = data.time
        for _ in range(3):
            self.add_block()

    def _build_program(self):
        # ArmStackingTask.initialize_arm uses this pose only at reset.
        start = np.array([-0.18, -0.03, self.clearance])
        self.segments = [Segment(1, start, start, OPEN, OPEN, "Looking")]

    def _pose(self, index):
        body = self.data.body(SORT_BLOCKS[index])
        rotation = body.xmat.reshape(3, 3)
        yaw = np.arctan2(rotation[1, 0], rotation[0, 0])
        # A square has four equivalent grasps; use the nearest axis to reduce wrist travel.
        yaw = (yaw + np.pi / 4) % (np.pi / 2) - np.pi / 4
        return body.xpos.copy(), float(yaw)

    def _speed(self, index):
        dof = self.block_dofs[index]
        return np.linalg.norm(self.data.qvel[dof : dof + 3])

    def _place_object(self, index, position, yaw):
        address, dof = self.block_qpos[index], self.block_dofs[index]
        self.data.qpos[address : address + 3] = position
        self.data.qpos[address + 3 : address + 7] = [np.cos(yaw / 2), 0, 0, np.sin(yaw / 2)]
        self.data.qvel[dof : dof + 6] = 0
        mujoco.mj_forward(self.model, self.data)

    def _sample_position(self, exclude=None):
        for _ in range(300):
            position = np.array(
                [self.rng.uniform(-0.26, -0.045), self.rng.uniform(-0.19, 0.13), 0.071]
            )
            others = [self._pose(i)[0] for i in self.active if i != exclude]
            if (
                exclude is not None
                and np.linalg.norm(position[:2] - self._pose(exclude)[0][:2]) < 0.10
            ):
                continue
            if any(np.linalg.norm(position[:2] - other[:2]) < 0.105 for other in others):
                continue
            # Also keep scene edits away from the jaws, including a carried object.
            palm = self.data.body("gripper_carrier").xpos
            if palm[2] < 0.22 and np.linalg.norm(position[:2] - palm[:2]) < 0.11:
                continue
            return position
        return None

    def add_block(self):
        available = [i for i in range(len(SORT_BLOCKS)) if i not in self.active]
        if not available:
            return False
        position = self._sample_position()
        if position is None:
            return False
        # Prefer colors with fewer unsorted objects; randomize ties.
        counts = [
            sum(i % 3 == color and i not in self.parked for i in self.active) for color in range(3)
        ]
        minimum = min(counts[i % 3] for i in available)
        choices = [i for i in available if counts[i % 3] == minimum]
        index = int(self.rng.choice(choices))
        self.model.geom_contype[self.block_geoms[index]] = 1
        self.model.geom_conaffinity[self.block_geoms[index]] = 1
        self._place_object(index, position, self.rng.uniform(-np.pi / 4, np.pi / 4))
        self.active.add(index)
        self.added += 1
        self.empty_since = None
        self.last_progress = self.data.time
        return True

    def move_block(self):
        candidates = [i for i in self.active if i not in self.parked]
        # Do not teleport a block out of a successful grasp.
        carrying = self.phase in ("Lifting", "Sorting", "Placing", "Releasing", "Checking")
        if carrying:
            candidates = [i for i in candidates if i != self.target]
        if not candidates:
            return False
        index = (
            self.target if self.target in candidates else int(self.rng.choice(sorted(candidates)))
        )
        position = self._sample_position(exclude=index)
        if position is None:
            return False
        self._place_object(index, position, self.rng.uniform(-np.pi / 4, np.pi / 4))
        self.last_progress = self.data.time
        if index == self.target:
            self._track(index)
            self.replans += 1
        return True

    def _begin(self, phase, goal=None, duration=0.5, yaw=None):
        self.phase, self.since = phase, self.data.time
        self.start = self.command_position.copy()
        self.goal = self.start.copy() if goal is None else np.asarray(goal).copy()
        self.start_yaw = self.yaw
        self.goal_yaw = self.yaw if yaw is None else yaw
        self.duration = duration

    def _track(self, index):
        self.target = index
        self.source, yaw = self._pose(index)
        goal = np.array([*self.source[:2], self.clearance])
        self.opening = OPEN
        if self.command_position[2] < self.clearance - 0.025:
            # Open and retract vertically before changing the grasp location.
            self._begin("Replanning", [*self.command_position[:2], self.clearance], 0.5)
            return
        duration = max(0.45, np.linalg.norm(goal - self.command_position) / 0.4)
        self._begin("Tracking", goal, duration, yaw)

    def _contacts(self):
        geom = self.block_geoms[self.target]
        touching = set()
        for contact in self.data.contact[: self.data.ncon]:
            pair = {int(contact.geom1), int(contact.geom2)}
            if geom in pair:
                touching |= pair & self.pads
        return touching == self.pads

    def _recover(self):
        self.retries += 1
        self.retry_after[self.target] = self.data.time + 1.0
        self.opening = OPEN
        goal = self.command_position.copy()
        goal[2] = self.clearance
        self._begin("Recovering", goal, 0.65)

    def _refresh(self):
        # Release/retract first; recycle the scene only once the jaws are clear.
        self.opening = OPEN
        self.target = None
        self._begin("New batch", [*self.command_position[:2], self.clearance], 0.65)

    def _refill(self):
        for index in list(self.active):
            self.model.geom_contype[self.block_geoms[index]] = 0
            self.model.geom_conaffinity[self.block_geoms[index]] = 0
            self._place_object(index, [0, 0, -1], 0)
        self.active.clear()
        self.parked.clear()
        self.retry_after.clear()
        self.empty_since = None
        self.last_progress = self.data.time
        self.batch += 1
        for _ in range(3):
            self.add_block()
        self._begin("Looking")

    def _choose(self):
        palm = self.data.body("gripper_carrier").xpos
        occupied = {i % 3 for i in self.parked}
        candidates = []
        for index in sorted(self.active - self.parked.keys()):
            position, _ = self._pose(index)
            if index % 3 in occupied or self.data.time < self.retry_after.get(index, 0):
                continue
            if self._speed(index) > 0.06 or abs(position[2] - 0.07) > 0.018:
                continue
            try:
                self.inverse_kinematics([*position[:2], self.clearance])
                self.inverse_kinematics(position + [0, 0, PALM_OFFSET])
            except ValueError:
                continue
            candidates.append((np.linalg.norm(position - palm), index))
        return min(candidates)[1] if candidates else None

    def update(self):
        now = self.data.time
        # Inactive pool objects are invisible and have collisions disabled. Keep
        # them parked instead of allowing their unused free joints to fall forever.
        for index in set(range(len(SORT_BLOCKS))) - self.active:
            address, dof = self.block_qpos[index], self.block_dofs[index]
            self.data.qpos[address : address + 3] = [0, 0, -1]
            self.data.qvel[dof : dof + 6] = 0
        for index, until in list(self.parked.items()):
            if now >= until:
                self.active.remove(index)
                del self.parked[index]
                self.model.geom_contype[self.block_geoms[index]] = 0
                self.model.geom_conaffinity[self.block_geoms[index]] = 0
                self._place_object(index, [0, 0, -1], 0)
        # Loop finished batches and recover from stranded objects or repeated
        # unsuccessful attempts. This runs on simulation time, so manual pause
        # freezes the watchdog as well as the physics.
        if not self.active and self.phase != "New batch":
            if self.empty_since is None:
                self.empty_since = now
            if now - self.empty_since > 1.5:
                self._refresh()
        if self.phase != "New batch" and now - self.last_progress > self.stall_timeout:
            self._refresh()
        if self.phase == "Looking":
            target = self._choose()
            if target is not None:
                self._track(target)
            elif self.active and now - self.since > 3.0:
                self._refresh()
        if self.target is not None and self.phase in ("Tracking", "Aligning", "Grasping"):
            position, yaw = self._pose(self.target)
            shift = np.linalg.norm(position[:2] - self.source[:2])
            if shift > 0.018 or abs(yaw - self.goal_yaw) > 0.18:
                self._track(self.target)
                self.replans += 1
        elapsed = now - self.since
        u = np.clip(elapsed / self.duration, 0, 1)
        eased = u**3 * (10 + u * (-15 + 6 * u))
        self.command_position = self.start + eased * (self.goal - self.start)
        self.yaw = self.start_yaw + eased * (self.goal_yaw - self.start_yaw)
        self._drive(self.command_position, self.opening, self.yaw)
        if elapsed < self.duration:
            return
        position = self._pose(self.target)[0] if self.target is not None else None
        palm = self.data.body("gripper_carrier").xpos
        if self.phase == "Tracking":
            self.source, _ = self._pose(self.target)
            self._begin("Aligning", self.source + [0, 0, PALM_OFFSET + 0.001], 0.65)
        elif self.phase == "Aligning":
            self.opening = CLOSED
            self._begin("Grasping", duration=0.5)
        elif self.phase == "Grasping":
            if self._contacts():
                self._begin("Lifting", [*palm[:2], self.clearance], 0.7)
            else:
                self._recover()
        elif self.phase == "Lifting":
            if not self._contacts() or position[2] < 0.16:
                self._recover()
            else:
                self.carry_offset = position - palm
                destination = BINS[self.target % 3] - self.carry_offset
                destination[2] = self.clearance
                self._begin("Sorting", destination, 0.85)
        elif self.phase == "Sorting":
            if not self._contacts() or np.linalg.norm(position - palm - self.carry_offset) > 0.025:
                self._recover()
            else:
                destination = BINS[self.target % 3] - self.carry_offset + [0, 0, 0.020]
                self._begin("Placing", destination, 0.65)
        elif self.phase == "Placing":
            self.opening = OPEN
            self._begin("Releasing", duration=0.35)
        elif self.phase == "Releasing":
            self._begin("Checking", duration=0.35)
        elif self.phase == "Checking":
            destination = BINS[self.target % 3]
            if (
                np.linalg.norm(position[:2] - destination[:2]) < 0.04
                and abs(position[2] - destination[2]) < 0.012
                and self._speed(self.target) < 0.05
            ):
                self.sorted += 1
                self.last_progress = now
                self.parked[self.target] = now + 1.0
                self._begin("Retracting", [*palm[:2], self.clearance], 0.55)
            else:
                self._recover()
        elif self.phase in ("Retracting", "Recovering"):
            self.target = None
            self._begin("Looking")
        elif self.phase == "Replanning":
            self._track(self.target)
        elif self.phase == "New batch":
            self._refill()

    def state(self):
        carrying = self.phase in ("Lifting", "Sorting", "Placing", "Releasing", "Checking")
        movable = self.active - self.parked.keys() - ({self.target} if carrying else set())
        return {
            "phase": self.phase,
            "sorted": self.sorted,
            "retries": self.retries,
            "replans": self.replans,
            "seed": self.seed,
            "batch": self.batch,
            "target": SORT_BLOCKS[self.target] if self.target is not None else None,
            "active": sorted(self.active),
            "can_add": len(self.active) < len(SORT_BLOCKS),
            "can_move": bool(movable),
            "blocks": [self._pose(i)[0].tolist() for i in range(len(SORT_BLOCKS))],
        }

    def hidden_geoms(self):
        return [geom for i, geom in enumerate(self.block_geoms) if i not in self.active]

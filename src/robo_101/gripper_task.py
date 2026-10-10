"""Shared Cartesian stacking program for the articulated arm and isolated gripper."""

from dataclasses import dataclass

import numpy as np

BLOCKS = ("mint_block", "amber_block", "coral_block")
HOMES = ((-0.20, -0.16, 0.070), (-0.20, 0, 0.070), (-0.20, 0.16, 0.070))
TOWER = ((0.16, 0, 0.070), (0.16, 0, 0.130), (0.16, 0, 0.190))
OPEN, CLOSED = 0.035, 0.010
PALM_OFFSET, CLEARANCE = 0.080, 0.390


@dataclass
class Segment:
    end_time: float
    start: np.ndarray
    end: np.ndarray
    opening_start: float
    opening_end: float
    phase: str
    block: str | None = None
    source: np.ndarray | None = None


class GripperTask:
    """Move the carrier smoothly; grasp/lift/release happens through the two motorized jaws."""

    clearance = CLEARANCE

    def __init__(self, model, data):
        self.model, self.data = model, data
        self.fingers = [model.actuator(f"finger_{side}_cmd").id for side in ("left", "right")]
        self.segments = []
        self.phase, self.cycle = "Approach", 1
        self._setup_drive()
        self._build_program()

    def _setup_drive(self):
        self.mocap = self.model.body_mocapid[self.model.body("gripper_target").id]

    def _drive(self, position, opening):
        self.data.mocap_pos[self.mocap] = position
        self.data.ctrl[self.fingers] = opening

    def _build_program(self):
        position = np.array([-0.20, -0.16, 0.28])
        opening, elapsed = OPEN, 0.0
        block, source_position = None, None

        def move(target, duration, phase, width=None):
            nonlocal position, opening, elapsed
            target = np.asarray(target, dtype=float)
            width = opening if width is None else width
            elapsed += duration
            self.segments.append(
                Segment(elapsed, position, target, opening, width, phase, block, source_position)
            )
            position, opening = target, width

        def transfer(source, destination, stacking, name):
            nonlocal block, source_position
            block, source_position = name, np.asarray(source, dtype=float)
            sx, sy, sz = source
            dx, dy, dz = destination
            move([sx, sy, self.clearance], 0.65, "Approach", OPEN)
            move([sx, sy, sz + PALM_OFFSET], 0.70, "Align")
            move(position, 0.40, "Grip", CLOSED)
            move([sx, sy, self.clearance], 0.80, "Lift")
            move([dx, dy, self.clearance], 0.90, "Transfer")
            move([dx, dy, dz + PALM_OFFSET + 0.002], 0.85, "Stack" if stacking else "Return")
            move(position, 0.40, "Release", OPEN)
            move([dx, dy, self.clearance], 0.55, "Retract")

        for index in range(3):
            transfer(HOMES[index], TOWER[index], True, BLOCKS[index])
        block, source_position = None, None
        move(position, 1.2, "Tower complete")
        for index in reversed(range(3)):
            transfer(TOWER[index], HOMES[index], False, BLOCKS[index])
        block, source_position = None, None
        move([-0.20, -0.16, 0.28], 0.75, "Ready", OPEN)
        self.duration = elapsed
        self.ends = np.array([segment.end_time for segment in self.segments])

    def update(self):
        elapsed = self.data.time % self.duration
        self.cycle = int(self.data.time // self.duration) + 1
        index = min(int(np.searchsorted(self.ends, elapsed, side="right")), len(self.segments) - 1)
        segment = self.segments[index]
        start = self.segments[index - 1].end_time if index else 0.0
        u = np.clip((elapsed - start) / (segment.end_time - start), 0, 1)
        eased = u * u * u * (10 + u * (-15 + 6 * u))
        position = segment.start + eased * (segment.end - segment.start)
        opening = segment.opening_start + eased * (segment.opening_end - segment.opening_start)
        self.phase = segment.phase
        position = self._correct_path(position, segment, eased, index)
        self._drive(position, opening)

    def _correct_path(self, position, segment, eased, index):
        return position

    def state(self):
        blocks = [self.data.body(name).xpos.copy() for name in BLOCKS]
        stacked = sum(
            np.linalg.norm(position - target) < 0.012
            for position, target in zip(blocks, TOWER, strict=True)
        )
        return {
            "phase": self.phase,
            "stacked": int(stacked),
            "cycle": self.cycle,
            "blocks": [position.tolist() for position in blocks],
        }

"""Physics and robot commands, independent of the viewer or a future ROS adapter."""

from pathlib import Path
from secrets import randbits

import mujoco
import numpy as np

from robo_101.arm_sorting import ArmSortingTask
from robo_101.arm_stacking import ArmStackingTask
from robo_101.gripper_task import GripperTask

SCENES = ("lab", "arm", "car", "gripper", "stacking", "sorting")
ARM_JOINTS = ("base_yaw", "shoulder", "elbow", "wrist_roll", "wrist_pitch", "tool_roll")
HOME = np.array([-0.25, -0.6, 1.2, 0.0, -0.6, 0.0])
WHEEL_RADIUS = 0.1
TRACK_WIDTH = 0.34


class Simulation:
    """All units are SI; angles are radians. Call commands and step on one thread."""

    def __init__(self, scene: str = "lab", *, seed: int | None = None):
        if scene not in SCENES:
            raise ValueError(f"Unknown scene {scene!r}; choose from {SCENES}")
        self.scene = scene
        self.seed = randbits(32) if seed is None else seed
        self.model = mujoco.MjModel.from_xml_path(
            str(Path(__file__).parent / "models" / f"{scene}_scene.xml")
        )
        self.data = mujoco.MjData(self.model)
        self.has_arm = scene in ("lab", "arm", "stacking", "sorting")
        self.has_car = scene in ("lab", "car")
        self.has_gripper = self.has_arm or scene == "gripper"
        self.gripper_task = None
        self.arm_actuators = (
            [self.model.actuator(f"{j}_cmd").id for j in ARM_JOINTS] if self.has_arm else []
        )
        self.wheel_actuators = (
            [self.model.actuator(f"wheel_{side}_cmd").id for side in ("left", "right")]
            if self.has_car
            else []
        )
        self.reset()

    def reset(self):
        mujoco.mj_resetData(self.model, self.data)
        if self.has_arm:
            for name, value in zip(ARM_JOINTS, HOME, strict=True):
                self.data.joint(name).qpos[0] = value
            self.set_arm_targets(HOME)
        if self.has_gripper:
            self.set_gripper(0.035)
            for side in ("left", "right"):
                self.data.joint(f"finger_{side}").qpos[0] = 0.035
        if self.scene == "gripper":
            self.gripper_task = GripperTask(self.model, self.data)
        elif self.scene == "stacking":
            self.gripper_task = ArmStackingTask(self.model, self.data, ARM_JOINTS)
            self.gripper_task.initialize_arm()
        elif self.scene == "sorting":
            self.gripper_task = ArmSortingTask(self.model, self.data, ARM_JOINTS, self.seed)
            self.gripper_task.initialize_arm()
        if self.has_car:
            self.drive(0, 0)
        mujoco.mj_forward(self.model, self.data)

    def set_arm_targets(self, positions):
        """Command six joint positions, clipped to the model's limits."""
        if not self.has_arm:
            raise ValueError("This scene has no arm")
        targets = np.asarray(positions, dtype=float)
        if targets.shape != (6,) or not np.all(np.isfinite(targets)):
            raise ValueError("Expected six finite joint positions")
        limits = self.model.actuator_ctrlrange[self.arm_actuators]
        self.data.ctrl[self.arm_actuators] = np.clip(targets, limits[:, 0], limits[:, 1])

    def set_gripper(self, opening: float):
        """Each finger travels 0–0.035 m outward from its closed position."""
        if not self.has_gripper:
            raise ValueError("This scene has no gripper")
        if not np.isfinite(opening):
            raise ValueError("Opening must be finite")
        for side in ("left", "right"):
            self.data.ctrl[self.model.actuator(f"finger_{side}_cmd").id] = np.clip(
                opening, 0, 0.035
            )

    def drive(self, linear: float, angular: float):
        """Differential drive: forward m/s and counterclockwise rad/s about +Z."""
        if not self.has_car:
            raise ValueError("This scene has no car")
        if not np.all(np.isfinite([linear, angular])):
            raise ValueError("Drive commands must be finite")
        speeds = (
            np.array(
                [
                    linear - angular * TRACK_WIDTH / 2,
                    linear + angular * TRACK_WIDTH / 2,
                ]
            )
            / WHEEL_RADIUS
        )
        # Scale both together to preserve curvature when motors saturate.
        speeds /= max(1.0, float(np.max(np.abs(speeds))) / 12)
        self.data.ctrl[self.wheel_actuators] = speeds

    def demo(self):
        t = self.data.time
        if self.gripper_task:
            self.gripper_task.update()
        elif self.has_arm:
            target = HOME.copy()
            target[0] += 0.45 * np.sin(0.6 * t)
            target[1] += 0.15 * np.sin(0.8 * t)
            target[2] += 0.2 * np.sin(0.8 * t)
            target[4] -= 0.2 * np.sin(0.8 * t)
            self.set_arm_targets(target)
            self.set_gripper(0.0175 * (1 + np.cos(t)))
        if self.has_car:
            self.drive(0.24, 0.4)

    def step(self, count: int = 1):
        mujoco.mj_step(self.model, self.data, nstep=count)

    def state(self) -> dict:
        """JSON-friendly measurements suitable for logging or a future bridge."""
        result = {"scene": self.scene, "time": float(self.data.time)}
        if self.has_arm:
            result["arm"] = {
                "names": list(ARM_JOINTS),
                "position": [float(self.data.joint(j).qpos[0]) for j in ARM_JOINTS],
                "velocity": [float(self.data.joint(j).qvel[0]) for j in ARM_JOINTS],
                "end_effector_xyz": self.data.site("end_effector").xpos.tolist(),
            }
        if self.has_car:
            result["car"] = {
                "position_xyz": self.data.body("rover").xpos.tolist(),
                "orientation_wxyz": self.data.body("rover").xquat.tolist(),
                "wheel_velocity": [
                    float(self.data.joint(f"wheel_{s}").qvel[0]) for s in ("left", "right")
                ],
            }
        if self.gripper_task:
            result["task"] = self.gripper_task.state()
            if self.scene == "sorting":
                result["hidden_geoms"] = self.gripper_task.hidden_geoms()
        return result


def camera_for(scene: str) -> mujoco.MjvCamera:
    cam = mujoco.MjvCamera()
    cam.azimuth = 135
    cam.elevation = -30
    cam.distance = 4.5 if scene != "arm" else 2.1
    if scene in ("stacking", "sorting"):
        cam.distance = 1.65
        cam.lookat[:] = (-0.08, 0.03, 0.25)
        return cam
    if scene == "gripper":
        cam.distance = 1.1
        cam.azimuth = 135
        cam.elevation = -30
        cam.lookat[:] = (0, 0, 0.15)
        return cam
    cam.lookat[:] = (-0.85, 0.65, 0.7) if scene == "arm" else (0, 0, 0.35)
    return cam

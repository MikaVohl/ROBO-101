"""Closed-form inverse kinematics and joint control for the six-axis stacking arm."""

import mujoco
import numpy as np

from robo_101.gripper_task import PALM_OFFSET, GripperTask


class ArmStackingTask(GripperTask):
    """Use the shared Cartesian task with a fixed-base, motor-driven articulated arm."""

    clearance = 0.36

    def __init__(self, model, data, joints):
        self.joints = joints
        super().__init__(model, data)

    def _setup_drive(self):
        model = self.model
        self.arm = [model.actuator(f"{name}_cmd").id for name in self.joints]
        self.qpos = [model.joint(name).qposadr[0] for name in self.joints]
        self.dofs = [model.joint(name).dofadr[0] for name in self.joints]
        self.shoulder = (
            model.body("arm_base").pos + model.body("base_link").pos + model.body("upper_arm").pos
        )
        self.upper = float(model.body("forearm").pos[0])
        self.lower = float(
            model.body("wrist_roll_link").pos[0] + model.body("wrist_pitch_link").pos[0]
        )
        self.tool_offset = float(model.body("tool").pos[0])
        self.kp = model.actuator_gainprm[self.arm, 0].copy()
        self.kv = -model.actuator_biasprm[self.arm, 2].copy()
        self.limits = model.actuator_ctrlrange[self.arm].copy()
        self.previous = None
        self.previous_time = None
        self.feedback_segment = None
        self.source_correction = np.zeros(3)
        self.place_correction = np.zeros(3)

    def inverse_kinematics(self, palm, yaw=0.0):
        """Elbow-up solution with jaws pointing down and remaining aligned to the grid.

        Solve the two-link shoulder/elbow triangle at the wrist, then compensate
        pitch and base yaw at the spherical wrist. Joint six preserves the jaw
        orientation as joint one turns. Joint four remains available for other poses.
        """
        wrist = np.asarray(palm, dtype=float) + [0, 0, self.tool_offset]
        delta = wrist - self.shoulder
        radius = np.hypot(delta[0], delta[1])
        cosine = (radius * radius + delta[2] ** 2 - self.upper**2 - self.lower**2) / (
            2 * self.upper * self.lower
        )
        if not np.isfinite(cosine) or abs(cosine) > 1:
            raise ValueError("Stacking target is outside the arm's reach")
        elbow = np.arccos(cosine)
        shoulder = np.arctan2(-delta[2], radius) - np.arctan2(
            self.lower * np.sin(elbow), self.upper + self.lower * np.cos(elbow)
        )
        base_yaw = np.arctan2(delta[1], delta[0])
        targets = np.array(
            [base_yaw, shoulder, elbow, 0, np.pi / 2 - shoulder - elbow, base_yaw - yaw]
        )
        if np.any(targets < self.limits[:, 0]) or np.any(targets > self.limits[:, 1]):
            raise ValueError("Stacking target exceeds an arm joint limit")
        return targets

    def initialize_arm(self):
        # Set the initial pose only at reset. During the task, motors move every joint.
        targets = self.inverse_kinematics(self.segments[0].start)
        self.data.qpos[self.qpos] = targets
        self.data.ctrl[self.arm] = targets
        mujoco.mj_forward(self.model, self.data)
        self.previous, self.previous_time = targets, self.data.time
        self._drive(self.segments[0].start, self.segments[0].opening_start)

    def _correct_path(self, position, segment, eased, index):
        if self.feedback_segment != index:
            self.feedback_segment = index
            if segment.phase == "Approach" and segment.block:
                # Recenter on the measured pickup position instead of accumulating
                # small contact/servo offsets over many repeat cycles.
                self.source_correction = self.data.body(segment.block).xpos - segment.source
                self.source_correction = self.source_correction.copy()
                self.place_correction = np.zeros(3)
            elif segment.phase == "Lift" and segment.block:
                relative = (
                    self.data.body(segment.block).xpos - self.data.body("gripper_carrier").xpos
                )
                self.place_correction = -relative - [0, 0, PALM_OFFSET]
                # A failed grasp should not pull an IK target outside the workcell.
                self.place_correction = np.clip(self.place_correction, -0.02, 0.02)
        if segment.phase == "Approach":
            correction = eased * self.source_correction
        elif segment.phase in ("Align", "Grip", "Lift"):
            correction = self.source_correction
        elif segment.phase == "Transfer":
            correction = (1 - eased) * self.source_correction + eased * self.place_correction
        elif segment.phase in ("Stack", "Return", "Release"):
            correction = self.place_correction
        elif segment.phase == "Retract":
            correction = (1 - eased) * self.place_correction
        else:
            correction = np.zeros(3)
        return position + correction

    def _drive(self, position, opening, yaw=0.0):
        targets = self.inverse_kinematics(position, yaw)
        dt = self.data.time - self.previous_time if self.previous_time is not None else 0
        velocity = (targets - self.previous) / dt if dt > 0 else np.zeros(6)
        # Compensate gravity and the velocity-servo term so the jaws track the
        # Cartesian path instead of lagging behind it while carrying a block.
        command = targets + (self.kv * velocity + self.data.qfrc_bias[self.dofs]) / self.kp
        self.data.ctrl[self.arm] = np.clip(command, self.limits[:, 0], self.limits[:, 1])
        self.data.ctrl[self.fingers] = opening
        self.previous, self.previous_time = targets, self.data.time

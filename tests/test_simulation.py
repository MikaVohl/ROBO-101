import mujoco
import numpy as np
import pytest

from robo_101.simulation import HOME, SCENES, Simulation


@pytest.mark.parametrize("scene", SCENES)
def test_models_remain_stable(scene):
    sim = Simulation(scene)
    for _ in range(2500):
        sim.demo()
        sim.step()
    assert sim.data.time == pytest.approx(5)
    assert np.all(np.isfinite(sim.data.qpos))
    assert not any(w.number for w in sim.data.warning)
    if sim.has_car:
        assert 0.08 < sim.data.body("rover").xpos[2] < 0.2
    if sim.has_arm:
        assert sim.data.site("end_effector").xpos[2] > (
            0.04 if scene in ("stacking", "sorting") else 0.54
        )


def test_arm_tracks_command_and_gripper_moves():
    sim = Simulation("arm")
    target = HOME.copy()
    target[0] = 0.5
    sim.set_arm_targets(target)
    sim.set_gripper(0)
    sim.step(1500)
    actual = [sim.data.joint(j).qpos[0] for j in sim.state()["arm"]["names"]]
    np.testing.assert_allclose(actual, target, atol=0.08)
    assert sim.data.joint("finger_left").qpos[0] < 0.005


def test_car_moves_forward_and_turns_left():
    sim = Simulation("car")
    sim.step(250)
    start = sim.data.body("rover").xpos.copy()
    sim.drive(0.3, 0)
    sim.step(1000)
    assert sim.data.body("rover").xpos[0] > start[0] + 0.4
    assert abs(sim.data.body("rover").xpos[1] - start[1]) < 0.1
    sim.drive(0, 0.6)
    sim.step(1000)
    orientation = sim.data.body("rover").xmat.reshape(3, 3)
    assert np.arctan2(orientation[1, 0], orientation[0, 0]) > 0.5
    sim.drive(0, 0)
    sim.step(1000)
    assert abs(sim.data.joint("wheel_left").qvel[0]) < 0.1


def test_reset_and_command_limits():
    sim = Simulation("lab")
    sim.drive(100, 100)
    assert np.max(np.abs(sim.data.ctrl[sim.wheel_actuators])) <= 12
    sim.set_arm_targets(np.full(6, 100))
    np.testing.assert_allclose(
        sim.data.ctrl[sim.arm_actuators], sim.model.actuator_ctrlrange[sim.arm_actuators, 1]
    )
    sim.step(20)
    sim.reset()
    assert sim.data.time == 0
    np.testing.assert_allclose(sim.data.ctrl[sim.arm_actuators], HOME)
    np.testing.assert_allclose(sim.data.ctrl[sim.wheel_actuators], 0)
    assert sim.model.opt.integrator == mujoco.mjtIntegrator.mjINT_IMPLICITFAST


def test_bad_commands_are_rejected():
    sim = Simulation("lab")
    with pytest.raises(ValueError):
        sim.set_arm_targets([0, 0])
    with pytest.raises(ValueError):
        sim.drive(float("nan"), 0)


@pytest.mark.parametrize("scene", ["gripper", "stacking"])
def test_gripper_stacks_and_unstacks_with_contacts_over_repeated_cycles(scene):
    from robo_101.gripper_task import BLOCKS, HOMES, TOWER

    sim = Simulation(scene)
    towers = returns = 0
    previous = ""
    lifted = False
    cycles = 5 if scene == "stacking" else 2
    for _ in range(int(cycles * sim.gripper_task.duration / sim.model.opt.timestep)):
        sim.demo()
        sim.step()
        task = sim.gripper_task
        positions = np.array([sim.data.body(name).xpos for name in BLOCKS])
        lifted |= positions[0, 2] > 0.25
        if task.phase != previous:
            if task.phase == "Tower complete":
                np.testing.assert_allclose(positions, TOWER, atol=0.004)
                assert sim.state()["task"]["stacked"] == 3
                towers += 1
            elif task.phase == "Ready":
                np.testing.assert_allclose(positions, HOMES, atol=0.004)
                assert sim.state()["task"]["stacked"] == 0
                returns += 1
            previous = task.phase
    assert lifted and towers == returns == cycles
    assert np.all(np.isfinite(sim.data.qpos))
    assert not any(warning.number for warning in sim.data.warning)
    # Articulated mode uses only joint motors: no mocap carrier or block welds.
    assert sim.model.neq == (1 if scene == "gripper" else 0)
    assert sim.model.nmocap == (1 if scene == "gripper" else 0)
    if scene == "stacking":
        assert len(sim.arm_actuators) == 6
    for name in BLOCKS:
        body = sim.model.body(name).id
        assert sim.model.jnt_type[sim.model.body_jntadr[body]] == mujoco.mjtJoint.mjJNT_FREE
        assert body not in sim.model.eq_obj1id and body not in sim.model.eq_obj2id
    sim.reset()
    assert sim.gripper_task.phase == "Approach" and sim.data.time == 0


@pytest.mark.parametrize("scene", ["gripper", "stacking"])
def test_open_jaws_cannot_lift_a_block(scene):
    from robo_101.gripper_task import HOMES

    sim = Simulation(scene)
    for _ in range(1700):
        sim.demo()
        sim.set_gripper(0.035)
        sim.step()
    # Prescribing the carrier motion alone does not animate or attach the cube.
    np.testing.assert_allclose(sim.data.body("mint_block").xpos, HOMES[0], atol=0.002)


def test_stacking_inverse_kinematics_matches_model_and_rejects_unreachable_targets():
    from robo_101.gripper_task import HOMES, TOWER

    sim = Simulation("stacking")
    task = sim.gripper_task
    kinematics = mujoco.MjData(sim.model)
    for x, y, z in [*HOMES, *TOWER, (-0.20, 0.16, 0.28), (0.16, 0, 0.28)]:
        palm = np.array([x, y, z + 0.08])
        kinematics.qpos[task.qpos] = task.inverse_kinematics(palm)
        mujoco.mj_forward(sim.model, kinematics)
        np.testing.assert_allclose(kinematics.body("gripper_carrier").xpos, palm, atol=1e-9)
        np.testing.assert_allclose(
            kinematics.body("gripper_carrier").xmat.reshape(3, 3), np.eye(3), atol=1e-9
        )
    with pytest.raises(ValueError, match="outside the arm's reach"):
        task.inverse_kinematics([2, 0, 0.2])

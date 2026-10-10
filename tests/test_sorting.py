import mujoco
import numpy as np
import pytest

from robo_101.arm_sorting import BINS, SORT_BLOCKS
from robo_101.simulation import Simulation


def advance(sim, seconds, *, open_jaws=False):
    for _ in range(round(seconds / sim.model.opt.timestep)):
        sim.demo()
        if open_jaws:
            sim.set_gripper(0.035)
        sim.step()


def until(sim, predicate, seconds=10):
    for _ in range(round(seconds / sim.model.opt.timestep)):
        sim.demo()
        sim.step()
        if predicate():
            return
    pytest.fail(f"Condition not reached: {sim.gripper_task.state()}")


def test_random_layouts_have_reproducible_seeds_and_real_free_objects():
    first = Simulation("sorting", seed=42)
    replay = Simulation("sorting", seed=42)
    other = Simulation("sorting", seed=43)
    np.testing.assert_array_equal(first.data.qpos, replay.data.qpos)
    assert not np.array_equal(first.data.qpos, other.data.qpos)
    advance(first, 2)
    advance(replay, 2)
    np.testing.assert_array_equal(first.data.qpos, replay.data.qpos)
    assert first.model.neq == first.model.nmocap == 0
    for name in SORT_BLOCKS:
        assert first.model.joint(f"{name}_joint").type == mujoco.mjtJoint.mjJNT_FREE
    first.reset()
    assert first.data.time == 0
    assert first.gripper_task.state()["seed"] == 42


@pytest.mark.parametrize("seed", [0, 4, 9])
def test_sorting_verifies_color_bins_and_replenishes_batches(seed):
    sim = Simulation("sorting", seed=seed)
    task = sim.gripper_task
    counted = 0
    for _ in range(13000):
        sim.demo()
        sim.step()
        if task.sorted > counted:
            # Count only a real, settled object in its matching bin.
            position = sim.data.body(SORT_BLOCKS[task.target]).xpos
            np.testing.assert_allclose(position, BINS[task.target % 3], atol=0.008)
            counted = task.sorted
    assert counted >= 4  # Includes a new batch, not just the initial three.
    assert task.added >= 6
    assert np.all(np.isfinite(sim.data.qpos))
    assert not any(warning.number for warning in sim.data.warning)


@pytest.mark.parametrize("phase", ["Tracking", "Aligning", "Grasping"])
def test_measured_target_motion_replans_and_recovers(phase):
    sim = Simulation("sorting", seed=8)
    task = sim.gripper_task
    until(sim, lambda: task.phase == phase)
    target = task.target
    position = task._sample_position(exclude=target)
    assert position is not None
    # External scene disturbance, bypassing the move command: the controller
    # must discover the new pose from measurements on its next update.
    task._place_object(target, position, 0.6)
    sim.demo()
    assert task.replans == 1
    assert task.phase in ("Tracking", "Replanning")
    until(sim, lambda: task.sorted >= 1)
    assert task.retries == 0


def test_failed_grasp_does_not_count_or_lift_and_is_retried():
    sim = Simulation("sorting", seed=9)
    task = sim.gripper_task
    advance(sim, 2.4, open_jaws=True)
    assert task.retries >= 1
    assert task.sorted == 0
    assert all(sim.data.body(SORT_BLOCKS[i]).xpos[2] < 0.09 for i in task.active)
    until(sim, lambda: task.sorted >= 1)


def test_dropped_object_is_detected_and_sorting_continues():
    sim = Simulation("sorting", seed=4)
    task = sim.gripper_task
    until(sim, lambda: task.phase == "Sorting")
    advance(sim, 0.9, open_jaws=True)
    assert task.retries >= 1
    assert task.sorted == 0
    until(sim, lambda: task.sorted >= 1, seconds=15)
    assert not any(warning.number for warning in sim.data.warning)


def test_add_and_move_pool_limits_and_visibility():
    sim = Simulation("sorting", seed=4)
    task = sim.gripper_task
    assert len(task.active) == 3
    assert len(sim.state()["hidden_geoms"]) == 3
    assert task.add_block()
    assert len(task.active) == 4
    assert len(sim.state()["hidden_geoms"]) == 2
    until(sim, lambda: task.phase == "Aligning")
    target = task.target
    before = task._pose(target)[0]
    assert task.move_block()
    assert np.linalg.norm(task._pose(target)[0] - before) >= 0.10
    assert task.replans == 1
    until(sim, lambda: task.sorted >= 1, seconds=15)

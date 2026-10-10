"""UV entry point, including the macOS main-thread viewer launcher."""

import argparse
import json
import math
import os
import queue
import shutil
import sys
import time
from pathlib import Path

from robo_101.simulation import ARM_JOINTS, SCENES, Simulation, camera_for

HELP = """
ROBO-101 controls (click the 3D viewport first)
  Up / Down   increase / decrease rover speed by 0.1 m/s
  Left/Right  increase left / right turn rate by 0.3 rad/s
  Enter       stop rover
  7 / 8       select previous / next arm joint (starts at base yaw)
  - / =       decrease / increase selected arm target by 5 degrees
  9           open / close gripper
  6           toggle demo motion (manual robot commands stop the demo)
  Space       pause / resume physics
  F9          reset robots and blocks (Fn+F9 on some Macs)
  F10         print these controls
  Mouse       left drag: rotate; right drag: pan; scroll: zoom
  Tab         toggle left panel; Shift+Tab: right panel > Control sliders
Close the window to exit. Rover commands persist until Enter or reset.
"""


def run_viewer(sim: Simulation, demo: bool, duration: float | None):
    import glfw
    import mujoco.viewer

    events = queue.SimpleQueue()
    selected = 0
    linear = angular = 0.0
    paused = False
    print(HELP, flush=True)
    print(f"Scene: {sim.scene} | Demo: {'on' if demo else 'off'}", flush=True)
    started = time.monotonic()
    with mujoco.viewer.launch_passive(sim.model, sim.data, key_callback=events.put) as viewer:
        cam = camera_for(sim.scene)
        with viewer.lock():
            viewer.cam.lookat[:] = cam.lookat
            viewer.cam.distance = cam.distance
            viewer.cam.azimuth = cam.azimuth
            viewer.cam.elevation = cam.elevation
        while viewer.is_running():
            frame_start = time.monotonic()
            if duration is not None and frame_start - started >= duration:
                break
            with viewer.lock():
                while not events.empty():
                    key = events.get()
                    if key in (ord("7"), ord("8")) and sim.has_arm:
                        selected = (selected + (1 if key == ord("8") else -1)) % 6
                        print(f"Selected: {ARM_JOINTS[selected]}", flush=True)
                    elif key in (ord("-"), ord("=")) and sim.has_arm:
                        if demo and sim.has_car:
                            sim.drive(0, 0)
                        demo = False
                        target = sim.data.ctrl[sim.arm_actuators].copy()
                        target[selected] += math.radians(5) * (1 if key == ord("=") else -1)
                        sim.set_arm_targets(target)
                        print(
                            f"{ARM_JOINTS[selected]} target: {target[selected]:.2f} rad", flush=True
                        )
                    elif key == ord("9") and sim.has_gripper:
                        if demo and sim.has_car:
                            sim.drive(0, 0)
                        demo = False
                        current = sim.data.ctrl[sim.model.actuator("finger_left_cmd").id]
                        sim.set_gripper(0.0 if current > 0.0175 else 0.035)
                    elif (
                        key
                        in (
                            glfw.KEY_UP,
                            glfw.KEY_DOWN,
                            glfw.KEY_LEFT,
                            glfw.KEY_RIGHT,
                            glfw.KEY_ENTER,
                        )
                        and sim.has_car
                    ):
                        demo = False
                        if key == glfw.KEY_UP:
                            linear = min(0.8, linear + 0.1)
                        elif key == glfw.KEY_DOWN:
                            linear = max(-0.8, linear - 0.1)
                        elif key == glfw.KEY_LEFT:
                            angular = min(2, angular + 0.3)
                        elif key == glfw.KEY_RIGHT:
                            angular = max(-2, angular - 0.3)
                        else:
                            linear = angular = 0.0
                        sim.drive(linear, angular)
                        print(f"Rover: {linear:.1f} m/s, {angular:.1f} rad/s", flush=True)
                    elif key == ord("6"):
                        demo = not demo
                        if sim.has_car:
                            linear = angular = 0.0
                            sim.drive(0, 0)
                        print(f"Demo: {'on' if demo else 'off'}", flush=True)
                    elif key == glfw.KEY_SPACE:
                        paused = not paused
                    elif key == glfw.KEY_F9:
                        demo = False
                        linear = angular = 0.0
                        sim.reset()
                    elif key == glfw.KEY_F10:
                        print(HELP, flush=True)
                if not paused:
                    # 10 physics steps per frame = 50 Hz viewer at 500 Hz physics.
                    if demo and sim.gripper_task:
                        for _ in range(10):
                            sim.demo()
                            sim.step()
                    else:
                        if demo:
                            sim.demo()
                        sim.step(10)
            viewer.sync()
            time.sleep(max(0.0, 10 * sim.model.opt.timestep - (time.monotonic() - frame_start)))


def positive_seconds(value: str) -> float:
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise argparse.ArgumentTypeError("duration must be finite and greater than zero")
    return seconds


def main():
    parser = argparse.ArgumentParser(description="Interactive arm and rover simulation with MuJoCo")
    parser.add_argument("scene", nargs="?", choices=SCENES, default="lab")
    parser.add_argument("--demo", action="store_true", help="start with autonomous demo motion")
    parser.add_argument("--headless", action="store_true", help="simulate without opening a window")
    parser.add_argument(
        "--duration", type=positive_seconds, help="seconds to run (headless default: 5)"
    )
    parser.add_argument("--snapshot", type=Path, help="save a PNG of the final headless state")
    args = parser.parse_args()
    if args.snapshot and not args.headless:
        parser.error("--snapshot requires --headless")
    # MuJoCo's macOS viewer must own the main Cocoa thread. Re-exec the same
    # environment through its bundled mjpython rather than requiring a special command.
    if sys.platform == "darwin" and not args.headless and os.environ.get("ROBO_MJPYTHON") != "1":
        launcher = Path(sys.executable).parent / "mjpython"
        executable = str(launcher) if launcher.exists() else shutil.which("mjpython")
        if not executable:
            parser.error("mjpython is missing; run uv sync")
        os.execve(
            executable,
            [executable, "-m", "robo_101", *sys.argv[1:]],
            {**os.environ, "ROBO_MJPYTHON": "1"},
        )
    sim = Simulation(args.scene)
    if args.headless:
        steps = math.ceil((args.duration or 5.0) / sim.model.opt.timestep)
        for _ in range(steps):
            if args.demo:
                sim.demo()
            sim.step()
        if args.snapshot:
            import mujoco
            from PIL import Image

            args.snapshot.parent.mkdir(parents=True, exist_ok=True)
            with mujoco.Renderer(sim.model, height=800, width=1280) as renderer:
                renderer.update_scene(sim.data, camera=camera_for(sim.scene))
                Image.fromarray(renderer.render()).save(args.snapshot)
        print(json.dumps(sim.state(), indent=2))
    else:
        run_viewer(sim, args.demo, args.duration)


if __name__ == "__main__":
    main()

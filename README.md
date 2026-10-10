# ROBO-101

A UV-managed robotics sandbox using **MuJoCo**, with a native interactive 3D viewer.
Includes an editable six-axis robot arm with a parallel gripper and two movable
blocks, and a differential-drive robot car with a chassis, wheel motors, and
low-friction caster supports. These are educational models rather than replicas
of particular commercial robots. The car steers by varying wheel speed; it does
not use automotive/Ackermann steering.

## Start here

For the **React browser interface**, run (Node.js 22.12+ and npm are required):

```sh
uv sync --locked
npm ci
npm run build
uv run robo-web
```

Open **http://127.0.0.1:8000** for the learning site: a reactive six-axis arm sorting demo on the landing
page, a clickable roadmap at `/roadmap`, and individual topic pages. Planning includes four runnable Python problems;
the other ten topics are still empty lesson shells. The
roadmap is a draggable, zoomable canvas with curved connections, node progress
bars, and a floating progress/calendar overlay. Geometry branches to Planning
and Control, and both lead to Estimation; Hardware and Tooling remain supporting
branches. Only the Planning problems have content so far.
Topic titles and graph connections are defined in `web/src/shared/curriculum.ts`.
Click a node for its lesson sidebar, completion checkbox, and star toggle.
Completion dates and stars are saved locally in your browser; opening a lesson
does not mark it complete. Drag the background to pan or a node to rearrange it,
scroll to zoom, and use the lower-left controls to zoom or restore the layout.
The progress overlay can be hidden and is initially collapsed on smaller screens.

The working simulator is at **http://127.0.0.1:8000/lab**. Choose the shared
lab, arm, or rover scene; use
the joint sliders, gripper button, rover controls, and demo toggle. Drag the 3D
view to orbit, scroll to zoom, or right-drag to pan. Space pauses physics. Click
the viewport and hold arrows/WASD to drive, or Enter to stop. Direction buttons
stop when released; speed and turn sliders keep their commanded values until
changed or stopped. A reset restores the entire scene; the arm's home button
only restores its joint targets.

The frontend uses **Vite + React + TypeScript**, with React Router for navigation.
Frontend source lives in `web/src/`, organized into pages, shared components, and
roadmap/planning/simulation features. Vite bundles the pinned Three.js and Ace
packages; the build copies the pinned Pyodide runtime locally. Learning assets live in `web/public/`.
The interface uses native system fonts, with no bundled font files. No CDN connection is required at runtime.

`npm run build` checks TypeScript and writes production assets to
`src/robo_101/web/` (generated, ignored by Git). FastAPI serves this build and runs
MuJoCo, streaming geometry transforms and measurements over `/ws` at up to 50 Hz.
Each connected tab has its own simulation; reconnecting starts a fresh lab. React
owns the controls and progress UI, while Three.js renders physics frames directly.
Leaving a page disposes its WebSocket, renderer, Python worker, and playback timers.
The browser needs WebGL; the server does not need a graphics session for this mode.

Use `uv run robo-web --port 8001` if port 8000 is occupied. After frontend source
changes, rebuild to update the site served by FastAPI. Missing builds return an
error explaining how to create one.

### Frontend development

Run the backend and Vite in separate terminals:

```sh
uv run robo-web
```

```sh
npm run dev
```

Open **http://127.0.0.1:5173** for React Fast Refresh. Vite proxies `/ws` and
`/health` to the backend on port 8000. If you change the backend port, update the
proxy target in `vite.config.ts`. Opening HTML directly from disk does not run
the application. Production uses the single FastAPI origin on port 8000.

```sh
npm run build
npm test
npm exec playwright -- install chromium  # First browser-test run only
npm run test:e2e                         # Starts an isolated backend on port 8001
npm run format:check
uv run pytest -q
uv run ruff check .
```

Browser tests cover actual Python execution, all four algorithms across three
cases, animation controls, saved drafts/progress, graph interactions, navigation,
robot controls, and mobile layouts. They use isolated browser storage.

Run `npm run build` before `uv build`; the Python wheel includes the generated
frontend, so Node is only required to develop/build it, not to serve that wheel.
The frontend package versions are recorded in `package-lock.json`; Python remains
managed by UV and `uv.lock`.

For the **native MuJoCo viewer**:

From this directory:

```sh
uv sync --locked
uv run robo lab --demo
```

The shared lab shows both robots moving. Close the window to exit. For individual
robots or manual control:

```sh
uv run robo arm
uv run robo car
uv run robo stacking --demo
uv run robo sorting --demo
uv run robo lab
```

Python 3.12 is pinned in `.python-version`; `uv.lock` records the dependencies.
UV manages the local `.venv`. On macOS, the launcher automatically uses MuJoCo's
`mjpython` so the viewer renders on the correct Cocoa thread. No separate MuJoCo
application installation is needed. A desktop graphics session is required for
the viewer and PNG rendering; headless physics alone needs no graphics session.

## Controls

Click the 3D viewport before using the keyboard.

| Key | Action |
| --- | --- |
| Up / Down | Increase / decrease car speed by 0.1 m/s |
| Left / Right | Increase left / right turn rate by 0.3 rad/s |
| Enter | Stop the car |
| 7 / 8 | Select previous / next arm joint; selection starts at base yaw |
| - / = | Move selected arm target by -/+ 5 degrees |
| 9 | Open / close the gripper |
| 6 | Toggle automatic demo motion |
| Space | Pause / resume physics |
| F9 | Reset robots and blocks, and stop the demo |
| F10 | Print these controls in the terminal |
| Left mouse drag | Orbit camera |
| Right mouse drag | Pan camera |
| Scroll | Zoom |
| Tab / Shift+Tab | Toggle left / right viewer panels |

Some Macs require **Fn+F9/F10**. Car commands persist until you stop or reset;
the arrow keys change commanded speed, rather than acting as a held throttle.
The car speed is capped at 0.8 m/s and turning at 2 rad/s. Manual robot commands
disable the demo. The arm/rover demo illustrates joint motion and circular driving; it
does not implement automatic grasping or navigation.

The home page uses a compact, table-mounted six-axis arm to sort randomly placed,
rotated blocks into matching color trays. A reactive controller selects a reachable,
settled object from measured poses, aligns the gripper, checks contact on both jaws,
and verifies the actual placement before incrementing the sorted count. Moving a
target triggers replanning; a missed grasp or dropped object triggers recovery and
another attempt. **Add block** introduces another object; **Move a block** relocates an
unsorted object without teleporting one out of the arm's grasp. A pool of six physical
blocks supports these interactions; completed objects recycle and empty batches refill.

This is conventional feedback control and inverse kinematics, without a trained AI
policy or camera-based perception. Joint motors with gravity/velocity compensation
move the arm, and the jaws lift free blocks through friction/contact. There are no
object welds or animated object trajectories. The scene is randomized per connection;
the reported `task.seed` reproduces a layout via `Simulation("sorting", seed=42)` or a
WebSocket scene command with `"seed": 42`. Replaying the same interaction sequence at
the same simulation steps is reproducible in the same environment.

The home demo autoplays, replenishes completed batches, and refreshes a stalled
batch when objects become unreachable or repeated grasps fail. Manual pause
freezes both the task and its recovery timers; camera orbit/zoom remain interactive.
Edit `sorting_scene.xml` and
`arm_sorting.py` to change the home demo. The original scripted arm and isolated
gripper stacking tasks remain available as `uv run robo stacking --demo` and
`uv run robo gripper --demo`; the arm/rover playground is at `/lab`.

## Write robot controllers

```sh
uv run python examples/control_robots.py
```

The physics API is independent of the GUI:

```python
from robo_101.simulation import HOME, Simulation

sim = Simulation("lab")
target = HOME.copy()
target[0] = 0.4
sim.set_arm_targets(target)  # radians, ordered as below
sim.set_gripper(0.02)  # each finger's outward travel, metres
sim.drive(linear=0.25, angular=0.3)  # forward m/s, counterclockwise rad/s
sim.step(500)  # 1 simulated second at 500 Hz
print(sim.state())
```

Arm joint order: `base_yaw`, `shoulder`, `elbow`, `wrist_roll`, `wrist_pitch`,
`tool_roll`. Targets are limited to the model's ranges. Wheel commands preserve
curvature when limited to motor speed. `state()` exposes joint positions and
velocities, tool position, rover pose, wheel speed, and simulated time. Use
`sim.model` and `sim.data` for the full MuJoCo API. Step physics and apply commands
on a single thread; GUI users must follow MuJoCo's viewer locking rules.

Edit robot geometry, mass, friction, and actuators in `src/robo_101/models/arm.xml`
and `car.xml`. Edit the arena in `environment.xml`. Restart the viewer to load
model changes.

## Headless runs and checks

```sh
uv run robo lab --headless --demo --duration 5
uv run robo arm --headless --demo --duration 2 --snapshot artifacts/arm.png
uv run pytest -q
uv run ruff check .
```

Headless runs print final measurements as JSON. `--duration` limits a GUI run
in wall-clock seconds or a headless run in simulated seconds. The tests check
model stability, arm target tracking, gripper motion, forward travel, left turns,
braking, command limits, and reset behavior.

## Later ROS 2 work

ROS 2 is not installed or bridged yet. Keep this UV environment for simulation;
ROS middleware and `rclpy` require a ROS installation with matching Python and
native libraries, rather than simply adding a PyPI dependency.

The intended adapter boundary is `Simulation`: accept ROS commands and apply them
on the simulation thread, and publish measurements from `state()`. Useful next
steps are `/cmd_vel` (`geometry_msgs/Twist`) calling `drive()`, `/joint_states`
(`sensor_msgs/JointState`), `/clock` (`rosgraph_msgs/Clock`), and an arm trajectory
controller with interpolation and limits. ROS quaternions use XYZW, while
`state()` explicitly returns MuJoCo's WXYZ convention. TF frames, odometry,
trajectory actions, cameras, lidar, Nav2, and MoveIt support remain future work.

For ROS projects centered on Gazebo, choose a supported ROS/Gazebo pairing in an
Ubuntu VM or another compatible ROS environment; models and integration will
need adaptation. MuJoCo's MJCF files are not interchangeable with Gazebo's SDF
or ROS URDF robot descriptions.

Official references:

- [MuJoCo Python installation and viewer](https://mujoco.readthedocs.io/en/stable/python.html)
- [MuJoCo viewer shortcuts](https://mujoco.readthedocs.io/en/stable/programming/samples.html#shortcuts)
- [ROS 2 Jazzy Ubuntu installation](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html)
- [Supported ROS/Gazebo combinations](https://gazebosim.org/docs/latest/ros_installation/)

## Planning code problems

Open `/lessons/planning` and choose DFS, BFS, Dijkstra, or A*. The editor starts
with a working Python reference implementation that you can modify; drafts are
saved per algorithm in this browser. Python runs in a local Pyodide WebAssembly
worker, with no server-side execution of submitted code. The editor and runtime
assets are pinned and bundled locally; no CDN connection is needed.

**Run** animates the selected grid case. **Submit** checks all three cases and
records completion only when they pass. DFS is judged for any valid route, BFS
for the fewest moves, and Dijkstra/A* for minimum entry cost. The starting cell
costs zero. The maze, weighted terrain, and unreachable-goal cases exercise
three different situations. Pause, single-step, replay, speed controls, and Stop
are available. Stop replaces the worker, so an infinite loop cannot trap the UI;
a five-second no-response limit also terminates a stuck run.

The API is `solve(grid, start, goal)`. Yield dictionaries containing `current`,
`visited`, and `frontier` coordinates to animate; return a start-to-goal path or
`[]` if unreachable. `neighbors` and `reconstruct` are provided helpers. Returning
a path without yielding is supported but has no intermediate visualization.
Planning's roadmap node now tracks four problems, giving 14 total completion
items across the roadmap. Older whole-topic Planning completion is retained in
storage but does not automatically complete the new individual problems.

Reference Python programs and the three cases live in
`web/public/planning/`. Their tests execute the exact served programs against
independent shortest-path oracles under the UV-managed Python runtime.

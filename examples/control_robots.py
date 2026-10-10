"""A controller without a GUI. Run: uv run python examples/control_robots.py"""

import json

from robo_101.simulation import HOME, Simulation

sim = Simulation("lab")
target = HOME.copy()
target[0] = 0.4
sim.set_arm_targets(target)
sim.set_gripper(0.02)
sim.drive(linear=0.25, angular=0.3)
sim.step(1000)  # 2 simulated seconds
sim.drive(0, 0)
print(json.dumps(sim.state(), indent=2))

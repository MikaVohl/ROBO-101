"""Serve the built React app and MuJoCo physics, with one lab per connection."""

import argparse
import asyncio
from contextlib import suppress
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import mujoco
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, ValidationError

from robo_101.simulation import HOME, Simulation

WEB = Path(__file__).parent / "web"
app = FastAPI(docs_url=None, redoc_url=None)
TOPIC_SLUGS = (
    "simulation-anatomy",
    "geometry-kinematics",
    "planning",
    "control",
    "hardware",
    "tooling",
    "estimation",
    "machine-learning",
    "reinforcement-learning",
    "vlas",
    "computer-vision",
)


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal[
        "scene",
        "arm",
        "gripper",
        "drive",
        "demo",
        "pause",
        "reset",
        "home",
        "add_block",
        "move_block",
    ]
    scene: Literal["lab", "arm", "car", "gripper", "stacking", "sorting"] = "lab"
    seed: int | None = Field(default=None, ge=0, le=4294967295)
    positions: list[FiniteFloat] | None = None
    opening: FiniteFloat = Field(default=0.035, ge=0, le=0.035)
    linear: FiniteFloat = Field(default=0, ge=-0.8, le=0.8)
    angular: FiniteFloat = Field(default=0, ge=-2, le=2)
    enabled: bool = False


class BrowserLab:
    def __init__(self, scene="lab", seed=None):
        self.sim = Simulation(scene, seed=seed)
        self.demo = False
        self.paused = False
        self.linear = self.angular = 0.0

    def stop_demo(self):
        if self.demo and self.sim.has_car:
            self.sim.drive(0, 0)
        self.demo = False

    def command(self, cmd: Command) -> bool:
        """Apply on the physics thread; return whether geometry changed."""
        if cmd.action == "scene":
            self.__init__(cmd.scene, cmd.seed)
            return True
        if cmd.action == "arm":
            if cmd.positions is None:
                raise ValueError("Arm command requires six positions")
            self.sim.set_arm_targets(cmd.positions)
            self.stop_demo()
        elif cmd.action == "gripper":
            self.sim.set_gripper(cmd.opening)
            self.stop_demo()
        elif cmd.action == "drive":
            self.sim.drive(cmd.linear, cmd.angular)
            self.demo = False
            self.linear, self.angular = cmd.linear, cmd.angular
        elif cmd.action == "home":
            self.sim.set_arm_targets(HOME)
            self.stop_demo()
        elif cmd.action == "demo":
            self.demo = cmd.enabled
            self.linear = self.angular = 0
            if self.sim.has_car:
                self.sim.drive(0, 0)
        elif cmd.action == "pause":
            self.paused = cmd.enabled
        elif cmd.action == "reset":
            self.sim.reset()
            self.demo = self.paused = False
            self.linear = self.angular = 0
        elif cmd.action in ("add_block", "move_block"):
            if self.sim.scene != "sorting":
                raise ValueError("Block interactions are available in the sorting scene")
            task = self.sim.gripper_task
            changed = task.add_block() if cmd.action == "add_block" else task.move_block()
            if not changed:
                raise ValueError(
                    "No free space for another block"
                    if cmd.action == "add_block"
                    else "No movable block is available"
                )
        return False

    def model_message(self):
        model = self.sim.model
        kinds = {
            mujoco.mjtGeom.mjGEOM_PLANE: "plane",
            mujoco.mjtGeom.mjGEOM_BOX: "box",
            mujoco.mjtGeom.mjGEOM_SPHERE: "sphere",
            mujoco.mjtGeom.mjGEOM_CAPSULE: "capsule",
            mujoco.mjtGeom.mjGEOM_CYLINDER: "cylinder",
        }
        return {
            "type": "model",
            "scene": self.sim.scene,
            "geoms": [
                {
                    "kind": kinds[int(model.geom_type[i])],
                    "size": model.geom_size[i].tolist(),
                    "rgba": model.geom_rgba[i].tolist(),
                }
                for i in range(model.ngeom)
            ],
            "arm_limits": model.actuator_ctrlrange[self.sim.arm_actuators].tolist(),
        }

    def frame(self):
        # mj_step integrates qpos after computing body transforms. Refresh them
        # so rendered geometry and measured joint positions share a timestamp.
        mujoco.mj_forward(self.sim.model, self.sim.data)
        state = self.sim.state()
        state.update(
            {
                "type": "state",
                "demo": self.demo,
                "paused": self.paused,
                "linear": 0.24 if self.demo and self.sim.has_car else self.linear,
                "angular": 0.4 if self.demo and self.sim.has_car else self.angular,
                "positions": self.sim.data.geom_xpos.tolist(),
                "rotations": self.sim.data.geom_xmat.tolist(),
                "arm_targets": self.sim.data.ctrl[self.sim.arm_actuators].tolist(),
                "gripper": float(self.sim.data.ctrl[self.sim.model.actuator("finger_left_cmd").id])
                if self.sim.has_gripper
                else 0,
            }
        )
        return state


def frontend():
    entry = WEB / "index.html"
    if not entry.is_file():
        raise HTTPException(
            status_code=503,
            detail="Frontend is not built. Run npm ci && npm run build from the project root.",
        )
    return FileResponse(entry)


@app.get("/")
async def index():
    return frontend()


@app.get("/roadmap")
async def roadmap():
    return frontend()


@app.get("/lab")
async def lab():
    return frontend()


@app.get("/lessons/{slug}")
async def lesson(slug: str):
    if slug not in TOPIC_SLUGS:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return frontend()


@app.get("/health")
async def health():
    return {"status": "ok", "physics": "mujoco"}


@app.websocket("/ws")
async def simulation_socket(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and urlparse(origin).netloc != ws.headers.get("host"):
        await ws.close(code=1008)
        return
    await ws.accept()
    lab = BrowserLab()
    pending = asyncio.Queue(maxsize=64)

    async def receive():
        try:
            while True:
                await pending.put(await ws.receive_json())
        except (WebSocketDisconnect, ValueError):
            await pending.put(None)

    receiver = asyncio.create_task(receive())
    try:
        await ws.send_json(lab.model_message())
        loop = asyncio.get_running_loop()
        while True:
            started = loop.time()
            while not pending.empty():
                message = pending.get_nowait()
                if message is None:
                    return
                try:
                    if lab.command(Command.model_validate(message)):
                        await ws.send_json(lab.model_message())
                except (ValueError, ValidationError) as exc:
                    await ws.send_json({"type": "error", "message": str(exc)})
            if not lab.paused:
                if lab.demo and lab.sim.gripper_task:
                    for _ in range(10):
                        lab.sim.demo()
                        lab.sim.step()
                else:
                    if lab.demo:
                        lab.sim.demo()
                    lab.sim.step(10)
            await ws.send_json(lab.frame())
            await asyncio.sleep(max(0, 0.02 - (loop.time() - started)))
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    finally:
        receiver.cancel()
        with suppress(asyncio.CancelledError):
            await receiver


# API and page routes precede static assets. Only known pages get the SPA entry.
app.mount("/", StaticFiles(directory=WEB, check_dir=False), name="frontend")


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description="ROBO-101 browser simulator")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    print(f"Robotics lab: http://127.0.0.1:{args.port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()

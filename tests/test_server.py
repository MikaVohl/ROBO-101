import re

import numpy as np
import pytest
from fastapi.testclient import TestClient

from robo_101.server import TOPIC_SLUGS, BrowserLab, Command, app


def receive_until(ws, predicate):
    for _ in range(100):
        message = ws.receive_json()
        if predicate(message):
            return message
    pytest.fail("Expected websocket response never arrived")


def test_web_controls_and_physics():
    lab = BrowserLab("car")
    lab.command(Command(action="drive", linear=0.3))
    lab.sim.step(1000)
    assert lab.frame()["car"]["position_xyz"][0] > 0.8
    lab.command(Command(action="reset"))
    assert lab.sim.data.time == 0
    assert not lab.demo
    np.testing.assert_allclose(lab.sim.data.ctrl[lab.sim.wheel_actuators], 0)
    lab.command(Command(action="scene", scene="arm"))
    lab.command(Command(action="arm", positions=[0.4, -0.6, 1.2, 0, -0.6, 0]))
    lab.sim.step(1000)
    assert lab.frame()["arm"]["position"][0] == pytest.approx(0.4, abs=0.02)


def test_websocket_commands_pause_and_scene_change():
    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert client.get("/vendor/pyodide/pyodide.asm.wasm").status_code == 200
        with client.websocket_connect("/ws") as ws:
            assert ws.receive_json()["type"] == "model"
            ws.send_json({"action": "pause", "enabled": True})
            paused = receive_until(ws, lambda m: m.get("paused"))
            again = ws.receive_json()
            assert again["time"] == paused["time"]
            ws.send_json({"action": "scene", "scene": "car"})
            model = receive_until(ws, lambda m: m["type"] == "model")
            assert model["scene"] == "car"
            assert model["arm_limits"] == []
            ws.send_json({"action": "drive", "linear": 0.3})
            frame = receive_until(ws, lambda m: m.get("linear") == 0.3)
            assert frame["scene"] == "car"
            assert len(frame["positions"]) == len(model["geoms"])
            ws.send_json({"action": "drive", "linear": 999})
            assert receive_until(ws, lambda m: m["type"] == "error")
            ws.send_json({"action": "reset"})
            assert receive_until(ws, lambda m: m.get("linear") == 0)["type"] == "state"


def test_tabs_have_independent_simulations():
    first, second = BrowserLab(), BrowserLab()
    first.command(Command(action="demo", enabled=True))
    first.sim.step(500)
    assert first.demo and first.sim.data.time > 0
    assert not second.demo and second.sim.data.time == 0


def test_sorting_interactions_over_websocket_preserve_pause_and_seed():
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        ws.send_json({"action": "scene", "scene": "sorting", "seed": 42})
        model = receive_until(ws, lambda m: m["type"] == "model" and m["scene"] == "sorting")
        assert len(model["arm_limits"]) == 6
        ws.send_json({"action": "pause", "enabled": True})
        paused = receive_until(ws, lambda m: m.get("paused"))
        assert paused["task"]["seed"] == 42
        assert len(paused["task"]["active"]) == 3
        ws.send_json({"action": "add_block"})
        added = receive_until(ws, lambda m: len(m.get("task", {}).get("active", [])) == 4)
        assert added["time"] == paused["time"]
        assert len(added["hidden_geoms"]) == 2
        ws.send_json({"action": "move_block"})
        moved = receive_until(
            ws, lambda m: m.get("task", {}).get("blocks") != added["task"]["blocks"]
        )
        assert moved["time"] == paused["time"]
        ws.send_json({"action": "scene", "scene": "arm"})
        receive_until(ws, lambda m: m["type"] == "model" and m["scene"] == "arm")
        ws.send_json({"action": "add_block"})
        assert "sorting scene" in receive_until(ws, lambda m: m["type"] == "error")["message"]


def test_learning_site_routes_and_frontend_assets():
    with TestClient(app) as client:
        entry = client.get("/")
        assert entry.status_code == 200
        assert '<div id="root"></div>' in entry.text
        assets = re.findall(r'(?:src|href)="(/assets/[^" ]+)"', entry.text)
        assert assets
        for asset in assets:
            assert client.get(asset).status_code == 200
        for route in ["/roadmap", "/lab", *(f"/lessons/{slug}" for slug in TOPIC_SLUGS)]:
            response = client.get(route)
            assert response.status_code == 200
            assert response.text == entry.text
        assert client.get("/lessons/planning?algorithm=astar").status_code == 200
        assert client.get("/lessons/nonexistent").status_code == 404
        assert client.get("/missing.js").status_code == 404
        for asset in [
            "/favicon.svg",
            "/planning/cases.json",
            "/planning/runtime.py",
            "/planning/solutions/dfs.py",
            "/vendor/pyodide/pyodide.mjs",
        ]:
            assert client.get(asset).status_code == 200


def test_missing_build_has_actionable_error(monkeypatch, tmp_path):
    from robo_101 import server

    monkeypatch.setattr(server, "WEB", tmp_path)
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 503
        assert "npm run build" in response.json()["detail"]
        assert client.get("/health").status_code == 200


@pytest.mark.parametrize("scene", ["gripper", "stacking"])
def test_showcase_scene_and_pause_over_websocket(scene):
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        ws.send_json({"action": "scene", "scene": scene})
        model = receive_until(ws, lambda m: m["type"] == "model" and m["scene"] == scene)
        assert len(model["arm_limits"]) == (6 if scene == "stacking" else 0)
        ws.send_json({"action": "demo", "enabled": True})
        frame = receive_until(ws, lambda m: m.get("demo") and m.get("scene") == scene)
        assert frame["task"]["phase"] == "Approach"
        assert len(frame["task"]["blocks"]) == 3
        assert ("arm" in frame) == (scene == "stacking")
        assert "car" not in frame
        ws.send_json({"action": "pause", "enabled": True})
        paused = receive_until(ws, lambda m: m.get("paused"))
        again = ws.receive_json()
        assert paused["time"] == again["time"]
        np.testing.assert_allclose(paused["positions"], again["positions"])

"""Execute the exact Python files served to the browser against independent oracles."""

import heapq
import json
import runpy
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1] / "web/public/planning"
CASES = json.loads((ROOT / "cases.json").read_text())


def optimum(case, weighted):
    grid = case["grid"]
    start, goal = tuple(case["start"]), tuple(case["goal"])
    queue = [(0, start)]
    distances = {start: 0}
    while queue:
        distance, cell = heapq.heappop(queue)
        if distance != distances[cell]:
            continue
        if cell == goal:
            return distance
        for dr, dc in ((-1, 0), (0, -1), (1, 0), (0, 1)):
            r, c = cell[0] + dr, cell[1] + dc
            if not (0 <= r < len(grid) and 0 <= c < len(grid[0])) or not grid[r][c]:
                continue
            candidate = distance + (grid[r][c] if weighted else 1)
            if candidate < distances.get((r, c), float("inf")):
                distances[r, c] = candidate
                heapq.heappush(queue, (candidate, (r, c)))
    return float("inf")


def execute(algorithm, case):
    runtime = runpy.run_path(str(ROOT / "runtime.py"))
    runtime["_prepare"]((ROOT / "solutions" / f"{algorithm}.py").read_text(), json.dumps(case))
    frames = []
    for _ in range(1000):
        result = json.loads(runtime["_advance_json"]())
        if result["done"]:
            return result["path"], frames
        frames.append(result["event"])
    pytest.fail("Reference algorithm did not terminate")


@pytest.mark.parametrize("algorithm", ["dfs", "bfs", "dijkstra", "astar"])
@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_reference_solutions_and_trace(algorithm, case):
    path, frames = execute(algorithm, case)
    assert frames
    assert len(frames) <= len(case["grid"]) * len(case["grid"][0])
    for frame in frames:
        r, c = frame["current"]
        assert case["grid"][r][c] > 0
    if case["id"] == "unreachable":
        assert path == []
        assert optimum(case, False) == float("inf")
        return
    assert path[0] == case["start"] and path[-1] == case["goal"]
    for i, (r, c) in enumerate(path):
        assert case["grid"][r][c] > 0
        if i:
            assert abs(r - path[i - 1][0]) + abs(c - path[i - 1][1]) == 1
    if algorithm == "bfs":
        assert len(path) - 1 == optimum(case, False)
    if algorithm in ("dijkstra", "astar"):
        assert sum(case["grid"][r][c] for r, c in path[1:]) == optimum(case, True)


def test_weighted_case_distinguishes_moves_from_cost():
    case = CASES[1]
    bfs, _ = execute("bfs", case)
    dijkstra, _ = execute("dijkstra", case)
    assert len(bfs) < len(dijkstra)
    cost = lambda path: sum(case["grid"][r][c] for r, c in path[1:])
    assert cost(bfs) > cost(dijkstra)


def test_return_without_yields_and_python_errors():
    runtime = runpy.run_path(str(ROOT / "runtime.py"))
    runtime["_prepare"]("def solve(grid, start, goal):\n    return []", json.dumps(CASES[2]))
    assert json.loads(runtime["_advance_json"]()) == {"done": True, "path": []}
    with pytest.raises(SyntaxError):
        runtime["_prepare"]("def solve(:", json.dumps(CASES[0]))

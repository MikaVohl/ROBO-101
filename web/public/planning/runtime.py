"""Browser Python runner and helpers shared by the planning templates."""

import inspect
import json


def neighbors(grid, cell):
    """Yield ((row, col), entry_cost), right/down/left/up; 0 means wall."""
    row, col = cell
    for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        nxt = (row + dr, col + dc)
        if 0 <= nxt[0] < len(grid) and 0 <= nxt[1] < len(grid[0]) and grid[nxt[0]][nxt[1]] > 0:
            yield nxt, grid[nxt[0]][nxt[1]]


def reconstruct(parents, goal):
    """Return the start-to-goal path for a parent map whose start maps to None."""
    path = []
    node = goal
    while node is not None:
        path.append(node)
        node = parents[node]
    return path[::-1]


def _prepare(source, payload):
    global _iterator, _direct, _steps
    case = json.loads(payload)
    namespace = {"neighbors": neighbors, "reconstruct": reconstruct}
    # Editable solutions execute in the browser's WebAssembly worker, never the server.
    exec(compile(source, "solution.py", "exec"), namespace)  # noqa: S102
    solve = namespace.get("solve")
    if not callable(solve):
        raise TypeError("Define solve(grid, start, goal)")
    result = solve(case["grid"], tuple(case["start"]), tuple(case["goal"]))
    _iterator = result if inspect.isgenerator(result) else None
    _direct = result
    _steps = 0


def _advance_json():
    global _steps
    if _iterator is None:
        return json.dumps({"done": True, "path": _direct})
    try:
        event = next(_iterator)
        _steps += 1
        if _steps > 5000:
            raise ValueError("Exceeded 5,000 visualization steps. Check for repeated visits.")
        if not isinstance(event, dict):
            raise TypeError("Yield a dictionary with current, visited, and frontier cells")
        return json.dumps({"done": False, "event": event})
    except StopIteration as finished:
        return json.dumps({"done": True, "path": finished.value})

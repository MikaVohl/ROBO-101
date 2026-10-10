from collections import deque


def solve(grid, start, goal):
    """Find the fewest-moves path using a first-in, first-out queue."""
    queue = deque([start])
    parents = {start: None}
    visited = set()

    while queue:
        current = queue.popleft()
        visited.add(current)
        yield {
            "current": current,
            "visited": list(visited),
            "frontier": list(queue),
        }
        if current == goal:
            return reconstruct(parents, goal)

        for nxt, cost in neighbors(grid, current):
            if nxt not in parents:
                parents[nxt] = current
                queue.append(nxt)
    return []

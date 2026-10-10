def solve(grid, start, goal):
    """Find any path using a last-in, first-out stack."""
    stack = [start]
    parents = {start: None}
    visited = set()

    while stack:
        current = stack.pop()
        visited.add(current)
        yield {
            "current": current,
            "visited": list(visited),
            "frontier": list(stack),
        }
        if current == goal:
            return reconstruct(parents, goal)

        # Reverse pushes so the first neighbor is explored first.
        for nxt, cost in reversed(list(neighbors(grid, current))):
            if nxt not in parents:
                parents[nxt] = current
                stack.append(nxt)
    return []

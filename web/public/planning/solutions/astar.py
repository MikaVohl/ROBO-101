import heapq


def solve(grid, start, goal):
    """Find the minimum-cost path using a Manhattan-distance heuristic."""

    def heuristic(cell):
        # Every open cell costs at least 1, so this never overestimates.
        return abs(cell[0] - goal[0]) + abs(cell[1] - goal[1])

    frontier = [(heuristic(start), 0, start)]
    distance = {start: 0}
    parents = {start: None}
    visited = set()

    while frontier:
        _, cost_so_far, current = heapq.heappop(frontier)
        if current in visited:
            continue
        visited.add(current)
        yield {
            "current": current,
            "visited": list(visited),
            "frontier": [cell for _, _, cell in frontier if cell not in visited],
        }
        if current == goal:
            return reconstruct(parents, goal)

        for nxt, entry_cost in neighbors(grid, current):
            candidate = cost_so_far + entry_cost
            if candidate < distance.get(nxt, float("inf")):
                distance[nxt] = candidate
                parents[nxt] = current
                heapq.heappush(frontier, (candidate + heuristic(nxt), candidate, nxt))
    return []

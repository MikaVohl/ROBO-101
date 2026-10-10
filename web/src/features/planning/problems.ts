import type { Algorithm, Cell, GridCase, JudgeResult, Problem } from '../../shared/types';
export const planningProblems: Problem[] = [
  {
    id: 'dfs',
    key: 'planning-dfs',
    title: 'Depth-First Search',
    short: 'DFS',
    number: '01',
    difficulty: 'Easy',
    objective: 'Find any valid route.',
    statement:
      'Navigate from start to goal using a depth-first search. Explore one branch before returning to alternatives. Your route does not need to be the shortest.',
    criterion:
      'Any contiguous, wall-free start-to-goal path is accepted. Return [] when the goal is unreachable.',
  },
  {
    id: 'bfs',
    key: 'planning-bfs',
    title: 'Breadth-First Search',
    short: 'BFS',
    number: '02',
    difficulty: 'Easy',
    objective: 'Find the fewest-moves route.',
    statement:
      'Explore the grid one distance layer at a time. Return a route with the fewest moves from start to goal. For this problem, every move counts as one, even on the weighted case.',
    criterion:
      'The route must have the minimum number of moves. Terrain entry cost is shown separately and is not the BFS objective.',
  },
  {
    id: 'dijkstra',
    key: 'planning-dijkstra',
    title: 'Dijkstra’s Algorithm',
    short: 'Dijkstra',
    number: '03',
    difficulty: 'Medium',
    objective: 'Find the minimum-cost route.',
    statement:
      'Plan a route through positive-cost terrain. Each move pays the entry cost of the destination cell; the starting cell is free. A longer route may cost less.',
    criterion:
      'The route must minimize total entry cost. Use accumulated cost to prioritize the frontier.',
  },
  {
    id: 'astar',
    key: 'planning-astar',
    title: 'A* Search',
    short: 'A*',
    number: '04',
    difficulty: 'Medium',
    objective: 'Find the minimum-cost route with a heuristic.',
    statement:
      'Use accumulated cost plus a heuristic to prioritize your search. On these four-connected grids, Manhattan distance is admissible because every open cell costs at least one.',
    criterion:
      'The route must minimize total entry cost, just as for Dijkstra. Try changing the heuristic and compare how many cells are explored.',
  },
];

export function referenceMetrics(test: GridCase) {
  const { grid, start, goal } = test;
  const key = (cell: Cell) => cell.join(',');
  const adjacent = ([r, c]: Cell): Cell[] =>
    (
      [
        [r, c + 1],
        [r + 1, c],
        [r, c - 1],
        [r - 1, c],
      ] as Cell[]
    ).filter(
      ([y, x]) => y >= 0 && x >= 0 && y < grid.length && x < grid[0].length && grid[y][x] > 0,
    );
  const queue: [Cell, number][] = [[start, 0]];
  const seen = new Set([key(start)]);
  let moves = Infinity;
  for (let i = 0; i < queue.length; i++) {
    const [cell, d] = queue[i];
    if (key(cell) === key(goal)) {
      moves = d;
      break;
    }
    for (const next of adjacent(cell))
      if (!seen.has(key(next))) {
        seen.add(key(next));
        queue.push([next, d + 1]);
      }
  }
  const frontier: [number, Cell][] = [[0, start]];
  const distances = new Map([[key(start), 0]]);
  let cost = Infinity;
  while (frontier.length) {
    frontier.sort((a, b) => b[0] - a[0]);
    const [d, cell] = frontier.pop()!;
    if (d !== distances.get(key(cell))) continue;
    if (key(cell) === key(goal)) {
      cost = d;
      break;
    }
    for (const next of adjacent(cell)) {
      const candidate = d + grid[next[0]][next[1]];
      if (candidate < (distances.get(key(next)) ?? Infinity)) {
        distances.set(key(next), candidate);
        frontier.push([candidate, next]);
      }
    }
  }
  return { moves, cost, reachable: Number.isFinite(moves) };
}

export function judgePath(problem: Algorithm, test: GridCase, path: unknown): JudgeResult {
  const expected = referenceMetrics(test);
  if (!Array.isArray(path))
    return {
      passed: false,
      message: 'Return a list of [row, column] cells, or [] if unreachable.',
    };
  if (!path.length)
    return {
      passed: !expected.reachable,
      message: expected.reachable
        ? 'A route exists, but your code returned an empty path.'
        : 'Correct: the goal is unreachable.',
      moves: 0,
      cost: 0,
    };
  const { grid, start, goal } = test;
  if (path.length > grid.length * grid[0].length)
    return {
      passed: false,
      message: 'The path is longer than the number of cells; check for loops.',
    };
  let cost = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    if (!Array.isArray(cell) || cell.length !== 2 || !cell.every(Number.isInteger))
      return { passed: false, message: 'Each path cell must contain two integers.' };
    const [r, c] = cell;
    if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length || grid[r][c] === 0)
      return { passed: false, message: `Path enters a wall or leaves the grid at [${r}, ${c}].` };
    if (i && Math.abs(r - path[i - 1][0]) + Math.abs(c - path[i - 1][1]) !== 1)
      return { passed: false, message: 'Consecutive cells must be one orthogonal move apart.' };
    if (i) cost += grid[r][c];
  }
  if (path[0].join(',') !== start.join(',') || path.at(-1).join(',') !== goal.join(','))
    return { passed: false, message: 'The path must begin at start and finish at goal.' };
  const moves = path.length - 1;
  if (problem === 'bfs' && moves !== expected.moves)
    return {
      passed: false,
      message: `Expected ${expected.moves} moves; received ${moves}.`,
      moves,
      cost,
    };
  if (['dijkstra', 'astar'].includes(problem) && cost !== expected.cost)
    return {
      passed: false,
      message: `Expected cost ${expected.cost}; received ${cost}.`,
      moves,
      cost,
    };
  return { passed: true, message: 'Valid route.', moves, cost };
}

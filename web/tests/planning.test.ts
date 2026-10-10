import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { judgePath, referenceMetrics } from '../src/features/planning/problems';
import type { GridCase } from '../src/shared/types';
const cases = JSON.parse(
  readFileSync(new URL('../public/planning/cases.json', import.meta.url), 'utf8'),
) as GridCase[];
describe('planning judge', () => {
  it('distinguishes weighted cost from minimum moves', () => {
    expect(referenceMetrics(cases[0])).toMatchObject({ reachable: true, moves: 46, cost: 46 });
    expect(referenceMetrics(cases[1])).toMatchObject({ reachable: true, moves: 22, cost: 26 });
    expect(referenceMetrics(cases[2]).reachable).toBe(false);
  });
  it('rejects missing, malformed, wall-crossing and noncontiguous routes', () => {
    expect(judgePath('dfs', cases[0], null).passed).toBe(false);
    expect(judgePath('dfs', cases[0], []).passed).toBe(false);
    expect(judgePath('dfs', cases[0], [[-1, 0]]).passed).toBe(false);
    expect(judgePath('dfs', cases[0], [cases[0].start, cases[0].goal]).passed).toBe(false);
    expect(judgePath('dfs', cases[0], [['1', 1]]).passed).toBe(false);
  });
  it.each(['dfs', 'bfs', 'dijkstra', 'astar'] as const)(
    'accepts an unreachable result for %s',
    (algorithm) => {
      expect(judgePath(algorithm, cases[2], [])).toMatchObject({ passed: true, moves: 0, cost: 0 });
    },
  );
});

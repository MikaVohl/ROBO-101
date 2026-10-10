import { afterEach, expect, it, vi } from 'vitest';
import { readProgress, topicProgress, completionItems } from '../src/shared/progress';
import { topics } from '../src/shared/curriculum';
afterEach(() => vi.unstubAllGlobals());
it('retains existing progress and keeps old topic completion separate from new problems', () => {
  vi.stubGlobal('localStorage', {
    getItem: () =>
      JSON.stringify({
        completed: {
          planning: '2026-10-09',
          'planning-dfs': '2026-10-09',
          control: '2026-10-08',
          unknown: '2026-10-09',
        },
        starred: ['planning-bfs', 'control', 'unknown'],
      }),
  });
  const progress = readProgress();
  expect(progress.completed).toEqual({
    planning: '2026-10-09',
    'planning-dfs': '2026-10-09',
    control: '2026-10-08',
  });
  expect(progress.starred).toEqual(['planning-bfs', 'control']);
  expect(
    topicProgress(
      topics.find((topic) => topic.slug === 'planning')!,
      progress,
    ),
  ).toEqual({ done: 1, total: 4 });
  expect(completionItems).toHaveLength(14);
});
it('recovers from broken or unavailable browser storage', () => {
  vi.stubGlobal('localStorage', { getItem: () => 'broken JSON' });
  expect(readProgress()).toEqual({ completed: {}, starred: [] });
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
  });
  expect(readProgress()).toEqual({ completed: {}, starred: [] });
});

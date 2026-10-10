import type { Topic, Progress } from './types';
import { topics } from './curriculum';
import { planningProblems } from '../features/planning/problems';

export const KEY = 'robo101.progress.v1';
const known = new Set([
  ...topics.map((topic) => topic.slug),
  ...planningProblems.map((problem) => problem.key),
]);
export function topicItems(topic: Topic) {
  return topic.slug === 'planning' ? planningProblems.map((problem) => problem.key) : [topic.slug];
}
export const completionItems = topics.flatMap(topicItems);
export function topicProgress(topic: Topic, progress: Progress) {
  const items = topicItems(topic);
  return {
    done: items.filter((key) => Object.hasOwn(progress.completed, key)).length,
    total: items.length,
  };
}
export function readProgress(): Progress {
  try {
    const data: { completed?: Record<string, unknown>; starred?: unknown[] } = JSON.parse(
      localStorage.getItem(KEY) || '{}',
    );
    return {
      completed: Object.fromEntries(
        Object.entries(data.completed || {}).filter(
          ([slug, day]) =>
            known.has(slug) && typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day),
        ),
      ) as Record<string, string>,
      starred: (Array.isArray(data.starred) ? data.starred : []).filter(
        (slug): slug is string => typeof slug === 'string' && known.has(slug),
      ),
    };
  } catch {
    return { completed: {}, starred: [] };
  }
}
export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
export function localDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export const progressGroups = [
  {
    label: 'Foundations',
    color: '#00b891',
    includes: (topic: Topic) => topic.kind === 'foundation',
  },
  { label: 'Core', color: '#efa000', includes: (topic: Topic) => topic.kind === 'core' },
  {
    label: 'Extensions',
    color: '#ef5263',
    includes: (topic: Topic) => ['support', 'application'].includes(topic.kind),
  },
];

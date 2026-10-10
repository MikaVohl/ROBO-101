import { useSyncExternalStore } from 'react';
import type { Progress } from './types';
import { KEY, readProgress, saveProgress } from './progress';

let current = readProgress();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener('storage', (event) => {
  if (event.key === KEY || event.key === null) {
    current = readProgress();
    notify();
  }
});
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function updateProgress(update: (previous: Progress) => Progress) {
  current = update(current);
  const saved = saveProgress(current);
  notify();
  return saved;
}
export function useProgress() {
  return [useSyncExternalStore(subscribe, () => current), updateProgress] as const;
}

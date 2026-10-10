import type { GridCase, SearchEvent } from '../../shared/types';
export type WorkerCommand =
  | { type: 'run'; job: number; code: string; batch: boolean; test: GridCase; cases: GridCase[] }
  | { type: 'pause'; value: boolean }
  | { type: 'step' }
  | { type: 'speed'; value: number };
export type WorkerResponse =
  | { type: 'ready'; version: string }
  | { type: 'init-error'; message: string }
  | { type: 'stdout'; job: number; text: string }
  | { type: 'heartbeat'; job: number }
  | { type: 'error'; job: number; message: string }
  | { type: 'frame'; job: number; event: SearchEvent }
  | { type: 'result'; job: number; path: unknown }
  | { type: 'case-result'; job: number; index: number; path: unknown }
  | { type: 'batch-done'; job: number };

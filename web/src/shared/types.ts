export type Algorithm = 'dfs' | 'bfs' | 'dijkstra' | 'astar';
export type Cell = [number, number];
export interface GridCase {
  id: string;
  name: string;
  description: string;
  grid: number[][];
  start: Cell;
  goal: Cell;
}
export interface Visual {
  visited: Cell[];
  frontier: Cell[];
  current: Cell | null;
  path: Cell[];
}
export interface SearchEvent {
  visited?: Cell[];
  frontier?: Cell[];
  current?: Cell;
}
export interface JudgeResult {
  passed: boolean;
  message: string;
  moves?: number;
  cost?: number;
}
export interface CaseResult {
  path: unknown;
  result: JudgeResult;
}
export interface Problem {
  id: Algorithm;
  key: string;
  title: string;
  short: string;
  number: string;
  difficulty: 'Easy' | 'Medium';
  objective: string;
  statement: string;
  criterion: string;
}
export interface Topic {
  slug: string;
  title: string;
  lines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'foundation' | 'core' | 'support' | 'application';
}
export type Connection = [string, string, boolean?];
export interface Progress {
  completed: Record<string, string>;
  starred: string[];
}

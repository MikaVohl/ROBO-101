import { planningProblems, judgePath } from './problems';
import { localDay } from '../../shared/progress';
import { updateProgress } from '../../shared/useProgress';
import type {
  Algorithm,
  Cell,
  CaseResult,
  GridCase,
  SearchEvent,
  Visual,
} from '../../shared/types';
import type { WorkerCommand, WorkerResponse } from './protocol';

const blank = (): Visual => ({ visited: [], frontier: [], current: null, path: [] });
const draftKey = (id: Algorithm) => `robo101.planning-code.${id}.v1`;
export interface PlanningState {
  algorithm: Algorithm;
  cases: GridCase[];
  caseIndex: number;
  source: string;
  ready: boolean;
  runtimeStatus: string;
  version: string;
  running: boolean;
  batch: boolean;
  paused: boolean;
  replaying: boolean;
  canReplay: boolean;
  speed: number;
  status: string;
  resultKind: '' | 'passed' | 'failed';
  output: string;
  gridStatus: string;
  steps: number;
  visual: Visual;
  results: (CaseResult | undefined)[];
  draftStatus: string;
  moves?: number;
  cost?: number;
}
/** Own worker execution and playback; React subscribes to snapshots instead of touching DOM. */
export class PlanningSession {
  private state: PlanningState;
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private templates: Partial<Record<Algorithm, string>> = {};
  private frames: Visual[] = [];
  private replayIndex = 0;
  private replayFinalPath: Cell[] = [];
  private replayTimer?: ReturnType<typeof setInterval>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private job = 0;
  private generation = 0;
  private disposed = false;
  private stdout = '';
  constructor(algorithm: Algorithm) {
    this.state = {
      algorithm,
      cases: [],
      caseIndex: 0,
      source: '',
      ready: false,
      runtimeStatus: 'Loading Python…',
      version: '',
      running: false,
      batch: false,
      paused: false,
      replaying: false,
      canReplay: false,
      speed: 65,
      status: 'Ready to run',
      resultKind: '',
      output: 'Choose a case and run your code.',
      gridStatus: 'Idle',
      steps: 0,
      visual: blank(),
      results: [],
      draftStatus: 'Draft saved locally',
    };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private patch(next: Partial<PlanningState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  async start() {
    this.disposed = false;
    const generation = ++this.generation;
    try {
      const response = await fetch('/planning/cases.json');
      if (!response.ok) throw new Error('Grid cases could not be loaded.');
      const cases = (await response.json()) as GridCase[];
      const templates = await Promise.all(
        planningProblems.map(async (problem) => {
          const response = await fetch(`/planning/solutions/${problem.id}.py`);
          if (!response.ok) throw new Error('Reference code could not be loaded.');
          return [problem.id, await response.text()] as const;
        }),
      );
      if (generation !== this.generation || this.disposed) return;
      this.templates = Object.fromEntries(templates);
      this.patch({ cases, source: this.readDraft(this.state.algorithm) });
      this.boot();
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        this.fail(String(error));
        this.patch({ runtimeStatus: 'Initialization failed' });
      }
    }
  }
  dispose() {
    this.saveDraft();
    this.disposed = true;
    this.generation++;
    this.job++;
    clearTimeout(this.saveTimer);
    clearTimeout(this.watchdog);
    clearInterval(this.replayTimer);
    this.worker?.terminate();
    this.worker = null;
  }
  private delay() {
    return Math.round(5 + (100 - this.state.speed) * 1.2);
  }
  private post(message: WorkerCommand) {
    this.worker?.postMessage(message);
  }
  private readDraft(id: Algorithm) {
    try {
      return localStorage.getItem(draftKey(id)) ?? this.templates[id] ?? '';
    } catch {
      return this.templates[id] ?? '';
    }
  }
  saveDraft = () => {
    if (!this.templates[this.state.algorithm]) return;
    try {
      localStorage.setItem(draftKey(this.state.algorithm), this.state.source);
      this.patch({ draftStatus: 'Draft saved locally' });
    } catch {
      this.patch({ draftStatus: 'Draft could not be saved' });
    }
  };
  setSource = (source: string) => {
    this.patch({ source });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(this.saveDraft, 350);
  };
  resetCode = () => {
    this.stop();
    this.setSource(this.templates[this.state.algorithm] ?? '');
    this.saveDraft();
  };
  chooseAlgorithm = (algorithm: Algorithm) => {
    if (algorithm === this.state.algorithm) return;
    this.stop();
    clearTimeout(this.saveTimer);
    this.saveDraft();
    this.patch({
      algorithm,
      source: this.readDraft(algorithm),
      results: [],
      status: 'Ready to run',
      resultKind: '',
      output: 'Choose a case and run your code.',
    });
    this.chooseCase(this.state.caseIndex);
  };
  chooseCase = (caseIndex: number) => {
    this.stop();
    clearInterval(this.replayTimer);
    this.frames = [];
    this.patch({
      caseIndex,
      replaying: false,
      canReplay: false,
      steps: 0,
      visual: blank(),
      gridStatus: 'Idle',
      moves: undefined,
      cost: undefined,
      paused: false,
    });
    const result = this.state.results[caseIndex];
    if (result) this.showPath(result);
  };
  private boot() {
    if (this.disposed) return;
    this.patch({ ready: false, runtimeStatus: 'Loading Python…' });
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (worker !== this.worker || this.disposed) return;
      if (data.type === 'ready') {
        this.patch({ ready: true, runtimeStatus: 'Python ready', version: data.version });
        return;
      }
      if (data.type === 'init-error') {
        this.fail(data.message);
        this.patch({ runtimeStatus: 'Python failed to load' });
        return;
      }
      if (data.job !== this.job || !this.state.running) return;
      if (data.type === 'stdout') {
        this.stdout = (this.stdout + data.text + '\n').slice(-10000);
        this.patch({ output: this.stdout });
      } else if (data.type === 'heartbeat') this.armWatchdog();
      else if (data.type === 'error') this.fail(data.message);
      else if (data.type === 'frame') {
        try {
          const visual = this.applyEvent(data.event);
          this.frames.push(structuredClone(visual));
          this.patch({ visual, steps: this.frames.length });
          this.armWatchdog();
        } catch (error) {
          this.fail(String(error));
          this.terminate();
          this.boot();
        }
      } else if (data.type === 'result' || data.type === 'case-result') {
        const index = data.type === 'result' ? this.state.caseIndex : data.index;
        const result: CaseResult = {
          path: data.path,
          result: judgePath(this.state.algorithm, this.state.cases[index], data.path),
        };
        const results = [...this.state.results];
        results[index] = result;
        this.patch({ results });
        if (index === this.state.caseIndex) this.showPath(result);
        if (data.type === 'result') {
          this.finish();
          this.patch({
            status: result.result.passed ? 'Passed' : 'Wrong answer',
            resultKind: result.result.passed ? 'passed' : 'failed',
            output: `${result.result.message}\n${result.result.moves !== undefined ? `Moves: ${result.result.moves} · Entry cost: ${result.result.cost}\n` : ''}${this.stdout}`,
          });
        } else {
          this.patch({ status: `Checking case ${index + 1} / ${this.state.cases.length}` });
          this.armWatchdog();
        }
      } else if (data.type === 'batch-done') {
        this.finish();
        const passed =
          this.state.results.length === this.state.cases.length &&
          this.state.cases.every((_, i) => this.state.results[i]?.result.passed);
        this.patch({
          status: passed ? 'Accepted · 3 / 3' : 'Wrong answer',
          resultKind: passed ? 'passed' : 'failed',
          output:
            this.state.results
              .map(
                (item, i) =>
                  `${this.state.cases[i].name}: ${item?.result.passed ? 'PASS' : 'FAIL'} — ${item?.result.message}`,
              )
              .join('\n') + (this.stdout ? '\n\n' + this.stdout : ''),
        });
        if (passed) {
          const problem = planningProblems.find((item) => item.id === this.state.algorithm)!;
          updateProgress((previous) => ({
            ...previous,
            completed: { ...previous.completed, [problem.key]: localDay() },
          }));
        }
        const result = this.state.results[this.state.caseIndex];
        if (result) this.showPath(result);
      }
    };
    worker.onerror = (event) => {
      this.fail(event.message || 'Python worker failed.');
      this.terminate();
      this.patch({ runtimeStatus: 'Python failed to load' });
    };
  }
  private terminate() {
    this.worker?.terminate();
    this.worker = null;
    clearTimeout(this.watchdog);
    this.patch({ ready: false });
  }
  private armWatchdog(force = false) {
    clearTimeout(this.watchdog);
    if (!this.state.running || (this.state.paused && !force)) return;
    this.watchdog = setTimeout(() => {
      this.fail('Execution exceeded 5 seconds without a step. Check for an infinite loop.');
      this.terminate();
      this.boot();
    }, 5000);
  }
  private finish() {
    clearTimeout(this.watchdog);
    this.patch({ running: false, paused: false, canReplay: this.frames.length > 0 });
  }
  private fail(message: string) {
    this.finish();
    this.patch({
      status: 'Execution error',
      resultKind: 'failed',
      gridStatus: 'Error',
      output: message,
    });
  }
  stop = () => {
    if (!this.state.running) return;
    this.job++;
    this.finish();
    this.terminate();
    this.patch({ gridStatus: 'Stopped', status: 'Stopped', resultKind: '' });
    this.boot();
  };
  run = (batch = false) => {
    if (!this.state.ready || this.state.running || !this.state.cases.length) return;
    this.saveDraft();
    clearInterval(this.replayTimer);
    this.job++;
    this.frames = [];
    this.stdout = '';
    this.patch({
      running: true,
      batch,
      paused: false,
      replaying: false,
      canReplay: false,
      results: [],
      visual: blank(),
      steps: 0,
      moves: undefined,
      cost: undefined,
      gridStatus: batch ? 'Testing' : 'Running',
      status: batch ? 'Checking cases…' : 'Running…',
      resultKind: '',
      output: batch ? 'Checking all three cases…' : 'Executing your Python…',
    });
    this.post({ type: 'speed', value: this.delay() });
    this.post({
      type: 'run',
      job: this.job,
      code: this.state.source,
      batch,
      test: this.state.cases[this.state.caseIndex],
      cases: this.state.cases,
    });
    this.armWatchdog();
  };
  private validCell(cell: unknown): cell is Cell {
    const test = this.state.cases[this.state.caseIndex];
    return (
      Array.isArray(cell) &&
      cell.length === 2 &&
      cell.every(Number.isInteger) &&
      cell[0] >= 0 &&
      cell[1] >= 0 &&
      cell[0] < test.grid.length &&
      cell[1] < test.grid[0].length
    );
  }
  private applyEvent(event: SearchEvent) {
    if (!event || typeof event !== 'object')
      throw new Error('Yield a dictionary of visualization cells.');
    const visual = { ...this.state.visual };
    for (const field of ['visited', 'frontier'] as const)
      if (event[field] !== undefined) {
        const cells = event[field];
        if (
          !Array.isArray(cells) ||
          cells.length > 2000 ||
          !cells.every((cell) => this.validCell(cell))
        )
          throw new Error(`${field} must contain valid grid coordinates.`);
        visual[field] = cells;
      }
    if (event.current !== undefined) {
      if (!this.validCell(event.current))
        throw new Error('current must be a valid [row, column] cell.');
      visual.current = event.current;
    }
    return visual;
  }
  private showPath({ path, result }: CaseResult) {
    const cells = result.passed && Array.isArray(path) ? (path as Cell[]) : [];
    this.patch({
      visual: {
        ...this.state.visual,
        path: cells,
        current: cells.at(-1) ?? this.state.visual.current,
      },
      moves: result.moves,
      cost: result.cost,
      gridStatus: result.passed ? (cells.length ? 'Path found' : 'No path') : 'Invalid path',
    });
  }
  private advanceReplay = () => {
    if (this.replayIndex >= this.frames.length) {
      clearInterval(this.replayTimer);
      this.patch({
        replaying: false,
        paused: false,
        visual: { ...this.state.visual, path: this.replayFinalPath },
        gridStatus: this.replayFinalPath.length ? 'Path found' : 'No path',
      });
      return;
    }
    this.patch({
      visual: structuredClone(this.frames[this.replayIndex++]),
      steps: this.replayIndex,
    });
  };
  private continueReplay() {
    clearInterval(this.replayTimer);
    this.replayTimer = setInterval(this.advanceReplay, this.delay());
  }
  replay = () => {
    if (!this.frames.length || this.state.running) return;
    if (!this.state.replaying) this.replayFinalPath = structuredClone(this.state.visual.path);
    this.replayIndex = 0;
    this.patch({ replaying: true, batch: false, paused: false, gridStatus: 'Replaying' });
    this.continueReplay();
  };
  pause = () => {
    if (this.state.replaying) {
      const paused = !this.state.paused;
      if (paused) clearInterval(this.replayTimer);
      else this.continueReplay();
      this.patch({ paused, gridStatus: paused ? 'Replay paused' : 'Replaying' });
    } else if (this.state.running) {
      const paused = !this.state.paused;
      this.patch({ paused, gridStatus: paused ? 'Paused' : 'Running' });
      this.post({ type: 'pause', value: paused });
      this.armWatchdog();
    }
  };
  step = () => {
    if (this.state.replaying) {
      clearInterval(this.replayTimer);
      this.patch({ paused: true });
      this.advanceReplay();
      if (this.state.replaying) this.patch({ gridStatus: 'Replay paused' });
    } else if (this.state.running) {
      this.patch({ paused: true, gridStatus: 'Paused' });
      this.post({ type: 'step' });
      this.armWatchdog(true);
    }
  };
  setSpeed = (speed: number) => {
    this.patch({ speed });
    this.post({ type: 'speed', value: this.delay() });
    if (this.state.replaying && !this.state.paused) this.continueReplay();
  };
}

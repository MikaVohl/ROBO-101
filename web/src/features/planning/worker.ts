/// <reference lib="webworker" />
import type { PyodideInterface } from 'pyodide';
import type { GridCase, SearchEvent } from '../../shared/types';
import type { WorkerCommand, WorkerResponse } from './protocol';
const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: WorkerResponse) => scope.postMessage(message);
let py: PyodideInterface | undefined,
  job = 0,
  active = false,
  paused = false,
  singleStep = false,
  speed = 35;
const ready = (async () => {
  // Preserve Pyodide's intact runtime: it resolves its WASM and standard library by URL.
  const runtimeUrl = '/vendor/pyodide/pyodide.mjs';
  const { loadPyodide } = (await import(/* @vite-ignore */ runtimeUrl)) as typeof import('pyodide');
  py = await loadPyodide({
    indexURL: '/vendor/pyodide/',
    stdout: (text) => send({ type: 'stdout', job, text: String(text).slice(0, 5000) }),
    stderr: (text) => send({ type: 'stdout', job, text: String(text).slice(0, 5000) }),
  });
  const response = await fetch('/planning/runtime.py');
  if (!response.ok) throw new Error('Python helper runtime could not be loaded.');
  py.runPython(await response.text());
  send({ type: 'ready', version: py.runPython('import sys; sys.version.split()[0]') as string });
})().catch((error) => send({ type: 'init-error', message: String(error) }));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function prepare(code: string, test: GridCase) {
  py!.globals.set('_source', code);
  py!.globals.set('_payload', JSON.stringify(test));
  py!.runPython('_prepare(_source, _payload)');
}
function advance(): { done: true; path: unknown } | { done: false; event: SearchEvent } {
  return JSON.parse(py!.runPython('_advance_json()') as string);
}
scope.onmessage = async ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === 'pause') {
    paused = data.value;
    return;
  }
  if (data.type === 'step') {
    paused = true;
    singleStep = true;
    return;
  }
  if (data.type === 'speed') {
    speed = data.value;
    return;
  }
  if (data.type !== 'run' || active) return;
  await ready;
  if (!py) return;
  job = data.job;
  active = true;
  paused = false;
  singleStep = false;
  try {
    if (data.batch) {
      for (let i = 0; i < data.cases.length; i++) {
        prepare(data.code, data.cases[i]);
        let frames = 0;
        while (true) {
          const result = advance();
          if (result.done) {
            send({ type: 'case-result', job, index: i, path: result.path });
            break;
          }
          frames++;
          if (frames % 40 === 0) {
            send({ type: 'heartbeat', job });
            await sleep(0);
          }
        }
      }
      send({ type: 'batch-done', job });
    } else {
      prepare(data.code, data.test);
      while (true) {
        if (paused && !singleStep) {
          await sleep(30);
          continue;
        }
        const result = advance();
        singleStep = false;
        if (result.done) {
          send({ type: 'result', job, path: result.path });
          break;
        }
        send({ type: 'frame', job, event: result.event });
        await sleep(speed);
      }
    }
  } catch (error) {
    send({ type: 'error', job, message: String(error) });
  } finally {
    active = false;
  }
};

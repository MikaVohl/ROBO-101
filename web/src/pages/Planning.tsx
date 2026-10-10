import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePage } from '../shared/usePage';
import { useProgress } from '../shared/useProgress';
import { planningProblems } from '../features/planning/problems';
import { PlanningSession } from '../features/planning/session';
import { CodeEditor } from '../features/planning/CodeEditor';
import { Grid } from '../features/planning/Grid';
const contract = `def solve(grid, start, goal):
    # Yield visualization frames while exploring.
    yield {"current": (row, col),
           "visited": [...], "frontier": [...]}
    # Return cells from start to goal, or [] if unreachable.
    return [(row, col), ...]`;
export default function Planning() {
  const [params, setParams] = useSearchParams();
  const algorithm =
    planningProblems.find((item) => item.id === params.get('algorithm'))?.id ?? 'dfs';
  const [session] = useState(() => new PlanningSession(algorithm));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const problem = planningProblems.find((item) => item.id === state.algorithm)!;
  usePage('planning', `${problem.short} · Planning · robo101`);
  const [progress] = useProgress(),
    [description, setDescription] = useState(false);
  useEffect(() => {
    void session.start();
    return () => session.dispose();
  }, [session]);
  useEffect(() => {
    session.chooseAlgorithm(algorithm);
  }, [session, algorithm]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        session.run();
      }
    };
    const save = () => session.saveDraft();
    window.addEventListener('keydown', keyboard);
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('pagehide', save);
    };
  }, [session]);
  const playbackDisabled = (!state.running && !state.replaying) || state.batch;
  return (
    <main id="main" className="planning-page">
      <div className="problem-bar">
        <div>
          <Link to="/roadmap">← Roadmap</Link>
          <span>/</span>
          <span>Planning</span>
        </div>
        <nav id="algorithm-tabs" aria-label="Planning problems">
          {planningProblems.map((item) => (
            <button
              key={item.id}
              data-algorithm={item.id}
              className={state.algorithm === item.id ? 'active' : ''}
              aria-pressed={state.algorithm === item.id}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('algorithm', item.id);
                setParams(next);
              }}
            >
              {item.short}
              {progress.completed[item.key] && <i className="solved-dot" />}
            </button>
          ))}
        </nav>
        <span id="problem-progress">
          {planningProblems.filter((item) => progress.completed[item.key]).length} / 4 complete
        </span>
      </div>
      <div className="problem-heading">
        <div>
          <span
            id="problem-difficulty"
            className={`difficulty ${problem.difficulty === 'Medium' ? 'medium' : ''}`}
          >
            {problem.difficulty}
          </span>
          <h1 id="problem-title">
            {problem.number}. {problem.title}
          </h1>
          <p id="problem-objective">{problem.objective}</p>
        </div>
        <div className="run-actions">
          <button
            id="run-code"
            disabled={!state.ready || state.running}
            onClick={() => session.run()}
          >
            ▶ Run
          </button>
          <button
            id="submit-code"
            className="submit"
            disabled={!state.ready || state.running}
            onClick={() => session.run(true)}
          >
            ✓ Submit
          </button>
          <button id="stop-code" hidden={!state.running} onClick={session.stop}>
            ■ Stop
          </button>
        </div>
      </div>
      <div className="problem-workspace">
        <section className="code-window" aria-label="Problem and code editor">
          <div className="window-tabs">
            <button
              id="code-tab"
              className={!description ? 'active' : ''}
              aria-pressed={!description}
              onClick={() => setDescription(false)}
            >
              〈/〉 Code
            </button>
            <button
              id="description-tab"
              className={description ? 'active' : ''}
              aria-pressed={description}
              onClick={() => setDescription(true)}
            >
              ▤ Description
            </button>
            <span id="python-status" className={state.ready ? 'ready' : ''}>
              {state.runtimeStatus}
            </span>
            <button
              id="reset-code"
              title="Restore reference implementation"
              aria-label="Restore reference implementation"
              onClick={session.resetCode}
            >
              ↺
            </button>
          </div>
          <div id="code-panel" hidden={description}>
            <div className="editor-caption">
              <span>
                Python <span id="python-version">{state.version}</span>
              </span>
              <span>Editable reference implementation</span>
            </div>
            <CodeEditor source={state.source} change={session.setSource} visible={!description} />
            <div className="editor-footer">
              <span>Ctrl / ⌘ + Enter to run</span>
              <span id="draft-status">{state.draftStatus}</span>
            </div>
          </div>
          <article id="description-panel" hidden={!description}>
            <h2 id="description-title">{problem.title}</h2>
            <p id="problem-statement">{problem.statement}</p>
            <h3>What the judge checks</h3>
            <p id="problem-criterion">{problem.criterion}</p>
            <h3>Function contract</h3>
            <pre>{contract}</pre>
            <p>
              Cells are <code>(row, column)</code>. Move up, down, left, or right. <code>0</code> is
              a wall; positive values are entry costs. The grid is 15 × 21.
            </p>
            <h3>Available helpers</h3>
            <p>
              <code>neighbors(grid, cell)</code> yields <code>(next_cell, entry_cost)</code> pairs.{' '}
              <code>reconstruct(parents, goal)</code> builds a path from a parent map whose start
              maps to <code>None</code>.
            </p>
            <p>
              Yielded frames drive the live view. Code that returns a path without yielding can
              still be judged, but will not show intermediate exploration.
            </p>
          </article>
          <section className="console-panel" aria-label="Run results">
            <div className="console-heading">
              <strong>Test result</strong>
              <span id="result-status" role="status" className={state.resultKind}>
                {state.status}
              </span>
            </div>
            <div id="test-results">
              {state.results.map(
                (item, i) =>
                  item && (
                    <button
                      key={i}
                      className={item.result.passed ? 'passed' : 'failed'}
                      onClick={() => session.chooseCase(i)}
                    >
                      {item.result.passed ? '✓' : '×'} Case {i + 1}
                    </button>
                  ),
              )}
            </div>
            <pre id="console-output">{state.output}</pre>
          </section>
        </section>
        <section className="grid-window" aria-label="Live grid visualization">
          <div className="grid-topline">
            <h2>Grid world</h2>
            <span className="live-status">
              <i />
              <span id="grid-status">{state.gridStatus}</span>
            </span>
          </div>
          <div id="case-tabs" className="case-tabs" role="group" aria-label="Visualization cases">
            {state.cases.map((test, i) => (
              <button
                key={test.id}
                data-case={i}
                className={i === state.caseIndex ? 'active' : ''}
                aria-pressed={i === state.caseIndex}
                onClick={() => session.chooseCase(i)}
              >
                {i + 1}. {test.name}
              </button>
            ))}
          </div>
          <p id="case-description">{state.cases[state.caseIndex]?.description}</p>
          <div className="grid-frame">
            <Grid test={state.cases[state.caseIndex]} visual={state.visual} />
          </div>
          <div className="grid-legend">
            {['Start', 'Goal', 'Visited', 'Frontier', 'Path', 'Wall'].map((label) => (
              <span key={label}>
                <i className={label.toLowerCase()} />
                {label}
              </span>
            ))}
          </div>
          <div className="playback">
            <button
              id="pause-run"
              disabled={playbackDisabled}
              aria-label={state.paused ? 'Resume visualization' : 'Pause visualization'}
              onClick={session.pause}
            >
              {state.paused ? '▶' : 'Ⅱ'}
            </button>
            <button
              id="step-run"
              disabled={playbackDisabled}
              aria-label="Step visualization"
              onClick={session.step}
            >
              ▸│
            </button>
            <button
              id="replay-run"
              disabled={!state.canReplay || state.running}
              aria-label="Replay visualization"
              onClick={session.replay}
            >
              ↺
            </button>
            <label htmlFor="playback-speed">Speed</label>
            <input
              id="playback-speed"
              type="range"
              min="1"
              max="100"
              value={state.speed}
              onChange={(event) => session.setSpeed(Number(event.target.value))}
            />
            <span id="step-counter">Step {state.steps}</span>
          </div>
          <div className="grid-metrics">
            <div>
              <span>Explored</span>
              <strong id="visited-count">
                {new Set(state.visual.visited.map((cell) => cell.join(','))).size}
              </strong>
            </div>
            <div>
              <span>Frontier</span>
              <strong id="frontier-count">
                {new Set(state.visual.frontier.map((cell) => cell.join(','))).size}
              </strong>
            </div>
            <div>
              <span>Path moves</span>
              <strong id="path-moves">{state.moves ?? '—'}</strong>
            </div>
            <div>
              <span>Entry cost</span>
              <strong id="path-cost">{state.cost ?? '—'}</strong>
            </div>
          </div>
          <p className="grid-note">
            Execution runs in your browser. Submit checks all three cases.
          </p>
        </section>
      </div>
    </main>
  );
}

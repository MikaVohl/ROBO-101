import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePage } from '../shared/usePage';
import { useSimulation } from '../features/simulation/useSimulation';
export default function Home() {
  usePage('home', 'robo101 · Robotics, made tangible.');
  const viewport = useRef<HTMLDivElement>(null);
  const { frame, latest, connection, error, send, resetCamera } = useSimulation(viewport, true);
  const connected = connection === 'Physics connected';
  return (
    <>
      <main id="main" className="home-page page-width">
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Robotics,
              <br />
              <span>
                made tangible<span className="accent-dot">.</span>
              </span>
            </h1>
            <p>
              A robot. A little curiosity.
              <br />A whole world to figure out.
            </p>
            <div className="hero-actions">
              <Link className="primary-link" to="/roadmap">
                Explore the roadmap <span>→</span>
              </Link>
              <Link className="secondary-link" to="/lab">
                Open simulator <span>↗</span>
              </Link>
            </div>
          </div>
          <div className="hero-simulation">
            <div className="simulation-topline">
              <span>
                <i className="live-dot" />
                <span id="hero-status" role="status">
                  {connected ? (frame?.paused ? 'Paused' : 'Live simulation') : connection}
                </span>
              </span>
              <span className="simulation-name">Reactive sorting</span>
            </div>
            <div
              ref={viewport}
              id="hero-viewport"
              tabIndex={0}
              aria-label="Live six-axis robot arm sorting randomized blocks by color. Drag to orbit and scroll to zoom."
            >
              <div id="hero-loading" hidden={!!frame}>
                {error || 'Starting the simulation…'}
              </div>
              <div className="hero-view-label">
                <span id="hero-sort-count">{frame?.task?.sorted ?? 0} sorted</span>
                <span>Drag to explore</span>
              </div>
            </div>
            <div className="simulation-bottomline">
              <span>
                <span className="live-dot" />
                <span id="hero-task-phase">{frame?.task?.phase ?? 'Looking'}</span>
              </span>
              <div>
                <span id="hero-clock">{(frame?.time ?? 0).toFixed(1)}s</span>
                <button id="hero-camera" aria-label="Reset simulation camera" onClick={resetCamera}>
                  ⌖
                </button>
                <button
                  id="hero-pause"
                  aria-label={frame?.paused ? 'Resume simulation' : 'Pause simulation'}
                  disabled={!connected}
                  onClick={() => send({ action: 'pause', enabled: !latest.current?.paused })}
                >
                  {frame?.paused ? '▶' : 'Ⅱ'}
                </button>
              </div>
            </div>
            <div className="simulation-interactions">
              <span role={error ? 'status' : undefined}>
                {error || 'Change the scene. Watch it adapt.'}
              </span>
              <div>
                <button
                  id="hero-add-block"
                  disabled={!connected || !frame?.task?.can_add}
                  onClick={() => send({ action: 'add_block' })}
                >
                  + Add block
                </button>
                <button
                  id="hero-move-block"
                  disabled={!connected || !frame?.task?.can_move}
                  onClick={() => send({ action: 'move_block' })}
                >
                  Move a block
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { usePage } from '../shared/usePage';
import { useSimulation } from '../features/simulation/useSimulation';
import type { SceneName, StateMessage } from '../features/simulation/types';

const sceneText = {
  lab: ['Two robots. One playground.', 'Explore motion, control, and contact.'],
  arm: ['Every joint is a possibility.', 'Six axes, a gripper, and a workbench.'],
  car: ['Take the wheel.', 'Explore differential drive in the rover arena.'],
};
const jointLabels = ['Base yaw', 'Shoulder', 'Elbow', 'Wrist roll', 'Wrist pitch', 'Tool roll'];
type Direction = 'forward' | 'backward' | 'left' | 'right';
const directions: Record<string, Direction> = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'backward',
  KeyS: 'backward',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};
function Coordinates({ values }: { values?: number[] }) {
  return (
    <>
      {values
        ? values.map((v, i) => (
            <Fragment key={i}>
              <span>{'XYZ'[i]}</span>
              {v.toFixed(2)}
              {'  '}
            </Fragment>
          ))
        : '—   —   —'}
    </>
  );
}
function Range({
  id,
  label,
  min,
  max,
  step,
  value,
  sync,
  unit,
  change,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  sync: StateMessage | null;
  unit?: string;
  change: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setLocal(value);
  }, [value, sync]);
  const fill = ((local - min) / (max - min)) * 100;
  return (
    <div className="range-row">
      <label htmlFor={id}>{label}</label>
      <output id={`${id}-value`}>
        {unit === '°' ? Math.round(local) : local.toFixed(2)}
        {unit === '°' ? (
          '°'
        ) : (
          <>
            {' '}
            <small>{unit}</small>
          </>
        )}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onPointerDown={() => {
          editing.current = true;
        }}
        onPointerUp={() => {
          editing.current = false;
        }}
        onPointerCancel={() => {
          editing.current = false;
        }}
        onBlur={() => {
          editing.current = false;
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          change(v);
        }}
      />
    </div>
  );
}
export default function Lab() {
  usePage('lab', 'Simulator · robo101');
  const viewport = useRef<HTMLDivElement>(null);
  const { model, frame, latest, connection, error, send, resetCamera } = useSimulation(viewport);
  const [held, setHeld] = useState<Direction[]>([]);
  const driveHeld = useRef(new Set<Direction>());
  const [toast, setToast] = useState('');
  const scene: SceneName = model?.scene === 'arm' ? 'arm' : model?.scene === 'car' ? 'car' : 'lab';
  const connected = connection === 'Physics connected';
  useEffect(() => {
    document.body.classList.toggle('disconnected', !connected);
    return () => document.body.classList.remove('disconnected');
  }, [connected]);
  useEffect(() => {
    if (error) setToast(error);
  }, [error]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const stop = useCallback(() => {
    driveHeld.current.clear();
    setHeld([]);
    if (scene !== 'arm') send({ action: 'drive', linear: 0, angular: 0 });
  }, [scene, send]);
  const heldDrive = useCallback(() => {
    const values = driveHeld.current;
    setHeld([...values]);
    if (scene !== 'arm')
      send({
        action: 'drive',
        linear: (Number(values.has('forward')) - Number(values.has('backward'))) * 0.4,
        angular: Number(values.has('left')) - Number(values.has('right')),
      });
  }, [scene, send]);
  useEffect(() => {
    driveHeld.current.clear();
    setHeld([]);
  }, [model]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) return;
      if (directions[event.code] && scene !== 'arm') {
        event.preventDefault();
        driveHeld.current.add(directions[event.code]);
        heldDrive();
      } else if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) send({ action: 'pause', enabled: !latest.current?.paused });
      } else if (event.code === 'Enter' && event.target === viewport.current) {
        event.preventDefault();
        stop();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (directions[event.code] && driveHeld.current.has(directions[event.code])) {
        driveHeld.current.delete(directions[event.code]);
        heldDrive();
      }
    };
    const blur = () => {
      if (driveHeld.current.size) stop();
    };
    const hidden = () => {
      if (document.hidden && driveHeld.current.size) stop();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      blur();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [scene, heldDrive, stop, latest, send]);
  const hold = (direction: Direction, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    driveHeld.current.add(direction);
    heldDrive();
  };
  const release = (direction: Direction) => {
    if (driveHeld.current.delete(direction)) heldDrive();
  };
  const time = frame?.time ?? 0;
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewport.current?.requestFullscreen();
    } catch {
      setToast('Fullscreen is unavailable in this browser.');
    }
  };
  return (
    <>
      <div className="lab-title page-width">
        <div>
          <span className="eyebrow">THE PLAYGROUND</span>
          <h1>Robotics Simulator</h1>
        </div>
        <div id="connection" className={`connection ${connected ? 'connected' : ''}`}>
          <i />
          <span>{connection}</span>
        </div>
      </div>
      <main id="main">
        <section className="workspace" aria-label="Simulation viewport">
          <div className="workspace-toolbar">
            <div className="scene-tabs" aria-label="Scene selection">
              {(['lab', 'arm', 'car'] as SceneName[]).map((name, i) => (
                <button
                  key={name}
                  data-scene={name}
                  className={scene === name ? 'active' : ''}
                  aria-pressed={scene === name}
                  onClick={() => send({ action: 'scene', scene: name })}
                >
                  {['Shared lab', 'Robot arm', 'Rover arena'][i]}
                </button>
              ))}
            </div>
            <span className="engine-label">
              MuJoCo physics <span>↗</span>
            </span>
          </div>
          <div
            ref={viewport}
            id="viewport"
            tabIndex={0}
            aria-label="Interactive 3D robot view. Drag to orbit, scroll to zoom."
          >
            <div className="viewport-heading">
              <span className="eyebrow">LIVE WORKSPACE</span>
              <h1 id="scene-title">{sceneText[scene][0]}</h1>
              <p id="scene-description">{sceneText[scene][1]}</p>
            </div>
            <div className="viewport-badge">
              <span className="live-dot" />
              <span id="run-label">{frame?.paused ? 'PAUSED' : 'RUNNING'}</span>
              <span className="divider">/</span>
              <span id="sim-time">
                {String(Math.floor(time / 60)).padStart(2, '0')}:
                {(time % 60).toFixed(1).padStart(4, '0')}
              </span>
            </div>
            <div id="loading" className={`loading ${frame ? 'hidden' : ''}`}>
              {error || 'Starting your lab…'}
            </div>
            <div className="view-buttons">
              <button id="camera-reset" aria-label="Reset camera" onClick={resetCamera}>
                ⌖
              </button>
              <button id="fullscreen" aria-label="Toggle fullscreen" onClick={fullscreen}>
                ⛶
              </button>
            </div>
            <div className="viewport-footer">
              <span>
                Drag to orbit <b>·</b> Scroll to zoom <b>·</b> Right drag to pan
              </span>
              <span className="axis-key">
                <b className="axis-x">X</b>
                <b className="axis-y">Y</b>
                <b className="axis-z">Z</b>
              </span>
            </div>
          </div>
          <div className="transport">
            <div className="transport-controls">
              <button
                id="pause"
                className="button primary"
                aria-pressed={frame?.paused ?? false}
                onClick={() => send({ action: 'pause', enabled: !latest.current?.paused })}
              >
                {frame?.paused ? '▶ Resume' : 'Ⅱ Pause'}
              </button>
              <button
                id="reset"
                className="button"
                onClick={() => {
                  driveHeld.current.clear();
                  setHeld([]);
                  send({ action: 'reset' });
                  setToast('Workspace reset');
                }}
              >
                ↺ Reset
              </button>
            </div>
            <button
              id="demo"
              className={`button demo-button ${frame?.demo ? 'active' : ''}`}
              aria-pressed={frame?.demo ?? false}
              onClick={() => {
                driveHeld.current.clear();
                setHeld([]);
                send({ action: 'demo', enabled: !latest.current?.demo });
              }}
            >
              <span className="toggle-track">
                <i />
              </span>{' '}
              Demo motion
            </button>
            <span className="transport-hint">Space to pause</span>
          </div>
          <div className="telemetry">
            <div>
              <span className="eyebrow">
                TOOL POSITION <small>m</small>
              </span>
              <p id="tool-position">
                <Coordinates values={frame?.arm?.end_effector_xyz} />
              </p>
            </div>
            <div>
              <span className="eyebrow">
                ROVER POSITION <small>m</small>
              </span>
              <p id="rover-position">
                <Coordinates values={frame?.car?.position_xyz} />
              </p>
            </div>
            <div>
              <span className="eyebrow">
                WHEEL SPEED <small>rad/s</small>
              </span>
              <p id="wheel-speed">
                {frame?.car?.wheel_velocity.map((v) => v.toFixed(2)).join(' / ') ?? '— / —'}
              </p>
            </div>
          </div>
        </section>
        <aside className="controls">
          <div className="controls-heading">
            <span className="eyebrow">CONTROL DESK</span>
            <h2>Robot controls</h2>
            <p>Explore the joints. Take the wheel.</p>
          </div>
          <section id="arm-controls" className="control-section" hidden={!model?.arm_limits.length}>
            <div className="section-heading">
              <h3>
                <span className="robot-icon arm-icon">↗</span> Robot arm
              </h3>
              <span className="tag">6 AXES</span>
            </div>
            <p className="section-caption">
              Joint targets <span>degrees</span>
            </p>
            <div id="joints">
              {model?.arm_limits.map((limits, i) => (
                <Range
                  sync={frame}
                  key={`${scene}-${i}`}
                  id={`joint-${i}`}
                  label={jointLabels[i]}
                  min={Math.ceil((limits[0] * 180) / Math.PI)}
                  max={Math.floor((limits[1] * 180) / Math.PI)}
                  step={0.1}
                  value={((frame?.arm_targets[i] ?? 0) * 180) / Math.PI}
                  unit="°"
                  change={(value) => {
                    const targets = [...(latest.current?.arm_targets ?? Array(6).fill(0))];
                    targets[i] = (value * Math.PI) / 180;
                    send({ action: 'arm', positions: targets });
                  }}
                />
              ))}
            </div>
            <div className="gripper-row">
              <span>Gripper</span>
              <button
                id="gripper"
                className="small-button"
                onClick={() =>
                  send({
                    action: 'gripper',
                    opening: (latest.current?.gripper ?? 0.035) > 0.0175 ? 0 : 0.035,
                  })
                }
              >
                {(frame?.gripper ?? 0.035) > 0.0175 ? 'Close fingers' : 'Open fingers'}
              </button>
            </div>
            <button
              id="home"
              className="button full-width"
              onClick={() => send({ action: 'home' })}
            >
              ↺ Return to home pose
            </button>
          </section>
          <section id="car-controls" className="control-section" hidden={scene === 'arm'}>
            <div className="section-heading">
              <h3>
                <span className="robot-icon car-icon">▰</span> Mobile rover
              </h3>
              <span className="tag">2 WHEELS</span>
            </div>
            <Range
              sync={frame}
              id="speed"
              label="Forward speed"
              min={-0.8}
              max={0.8}
              step={0.01}
              value={frame?.linear ?? 0}
              unit="m/s"
              change={(linear) =>
                send({ action: 'drive', linear, angular: latest.current?.angular ?? 0 })
              }
            />
            <Range
              sync={frame}
              id="turn"
              label="Turn rate"
              min={-2}
              max={2}
              step={0.01}
              value={frame?.angular ?? 0}
              unit="rad/s"
              change={(angular) =>
                send({ action: 'drive', linear: latest.current?.linear ?? 0, angular })
              }
            />
            <div className="drive-pad" aria-label="Hold a direction to drive">
              {(['forward', 'left', 'right', 'backward'] as Direction[]).map((direction, i) => (
                <button
                  key={direction}
                  data-drive={direction}
                  aria-label={['Drive forward', 'Turn left', 'Turn right', 'Drive backward'][i]}
                  className={held.includes(direction) ? 'pressed' : ''}
                  onPointerDown={(event) => hold(direction, event)}
                  onPointerUp={() => release(direction)}
                  onPointerCancel={() => release(direction)}
                  onLostPointerCapture={() => release(direction)}
                >
                  {['↑', '←', '→', '↓'][i]}
                </button>
              ))}
              <button id="stop" aria-label="Stop rover" onClick={stop}>
                ■
              </button>
            </div>
            <p className="drive-hint">
              Hold arrows or WASD to drive <span>·</span> Enter to stop
            </p>
          </section>
          <div className="desk-footer">
            <span className="footer-dot" />
            Local workspace <span>SI units · Z up</span>
          </div>
        </aside>
      </main>
      <div id="toast" role="status" aria-live="polite" className={toast ? 'visible' : ''}>
        {toast}
      </div>
    </>
  );
}

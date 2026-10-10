import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { topics, connections } from '../shared/curriculum';
import { completionItems, localDay, topicItems, topicProgress } from '../shared/progress';
import { useProgress } from '../shared/useProgress';
import { usePage } from '../shared/usePage';
import { Modal } from '../shared/Modal';
import { planningProblems } from '../features/planning/problems';
import { ProgressOverlay } from '../features/roadmap/ProgressOverlay';
import type { TopicFilter } from '../features/roadmap/ProgressOverlay';
import type { Topic } from '../shared/types';

const topicMap = new Map(topics.map((topic) => [topic.slug, topic]));
type Position = { x: number; y: number };
type View = Position & { scale: number };
type Drag = {
  pointer: number;
  target: HTMLElement;
  slug?: string;
  sx: number;
  sy: number;
  start: Position;
  moved: boolean;
};
const defaultPositions = () =>
  Object.fromEntries(topics.map((topic) => [topic.slug, { x: topic.x, y: topic.y }]));
export default function Roadmap() {
  usePage('roadmap', 'Roadmap · robo101');
  const canvas = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [progress, updateProgress] = useProgress();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<TopicFilter>('all');
  const [collapsed, setCollapsed] = useState(() => matchMedia('(max-width:900px)').matches);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  const [positions, setPositions] = useState(defaultPositions);
  const positionsRef = useRef(positions);
  const [dragClass, setDragClass] = useState('');
  const drag = useRef<Drag | null>(null),
    blockClickUntil = useRef(0);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'help' | 'reset' | null>(null);
  const completed = (topic: Topic) => {
    const amount = topicProgress(topic, progress);
    return amount.done === amount.total;
  };
  const visible = (topic: Topic) =>
    filter === 'all' ||
    (filter === 'incomplete' && !completed(topic)) ||
    (filter === 'starred' &&
      (progress.starred.includes(topic.slug) ||
        topicItems(topic).some((key) => progress.starred.includes(key))));
  const shown = topics.filter(visible);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const applyView = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
  }, []);
  const width = useCallback(() => {
    const node = canvas.current!;
    return (
      node.clientWidth -
      (node.clientWidth > 600 && !collapsedRef.current
        ? (overlayRef.current?.querySelector('aside')?.getBoundingClientRect().width ?? 340) + 40
        : 0)
    );
  }, []);
  const fit = useCallback(
    (reset = false) => {
      if (!canvas.current) return;
      if (reset) {
        positionsRef.current = defaultPositions();
        setPositions(positionsRef.current);
      }
      if (!shownRef.current.length) return;
      const p = positionsRef.current,
        shown = shownRef.current;
      const minX = Math.min(...shown.map((t) => p[t.slug].x)),
        minY = Math.min(...shown.map((t) => p[t.slug].y));
      const maxX = Math.max(...shown.map((t) => p[t.slug].x + t.w)),
        maxY = Math.max(...shown.map((t) => p[t.slug].y + t.h));
      const available = width();
      const scale = Math.max(
        0.45,
        Math.min(
          1,
          (available - 85) / (maxX - minX),
          (canvas.current.clientHeight - 75) / (maxY - minY),
        ),
      );
      applyView({
        scale,
        x: (available - (maxX - minX) * scale) / 2 - minX * scale,
        y: 24 - minY * scale,
      });
    },
    [applyView, width],
  );
  const zoom = useCallback(
    (factor: number, x = width() / 2, y = (canvas.current?.clientHeight ?? 0) / 2) => {
      const old = viewRef.current,
        scale = Math.max(0.25, Math.min(2.5, old.scale * factor)),
        ratio = scale / old.scale;
      applyView({ x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio, scale });
    },
    [width, applyView],
  );
  useEffect(() => {
    fit();
  }, [filter, collapsed, fit]);
  useEffect(() => {
    const node = canvas.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    const observer = new ResizeObserver(() => fit());
    observer.observe(node);
    return () => {
      node.removeEventListener('wheel', wheel);
      observer.disconnect();
    };
  }, [fit, zoom]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [message]);
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return;
    const node = (event.target as HTMLElement).closest<HTMLButtonElement>('.roadmap-node'),
      target = node ?? canvas.current!;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    const slug = node?.dataset.topic;
    drag.current = {
      pointer: event.pointerId,
      target,
      slug,
      sx: event.clientX,
      sy: event.clientY,
      start: slug ? { ...positionsRef.current[slug] } : { ...viewRef.current },
      moved: false,
    };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.sx,
      dy = event.clientY - current.sy;
    if (Math.hypot(dx, dy) < 4 && !current.moved) return;
    current.moved = true;
    setDragClass(current.slug ? 'dragging-node' : 'panning');
    if (current.slug) {
      const next = {
        ...positionsRef.current,
        [current.slug]: {
          x: current.start.x + dx / viewRef.current.scale,
          y: current.start.y + dy / viewRef.current.scale,
        },
      };
      positionsRef.current = next;
      setPositions(next);
    } else applyView({ ...viewRef.current, x: current.start.x + dx, y: current.start.y + dy });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.moved) blockClickUntil.current = performance.now() + 250;
    drag.current = null;
    setDragClass('');
    if (current.target.hasPointerCapture(event.pointerId))
      current.target.releasePointerCapture(event.pointerId);
  };
  const edgePath = (from: string, to: string) => {
    const a = topicMap.get(from)!,
      b = topicMap.get(to)!,
      p = positions[from],
      q = positions[to];
    const x1 = p.x + a.w / 2,
      y1 = p.y + a.h,
      x2 = q.x + b.w / 2,
      y2 = q.y,
      mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
  };
  const persist = (update: Parameters<typeof updateProgress>[0]) => {
    if (!updateProgress(update)) setMessage('Progress could not be saved in this browser.');
  };
  const count = completionItems.filter((key) => progress.completed[key]).length;
  const topic = selected ? topicMap.get(selected) : undefined;
  const incoming = connections.filter(([, to]) => to === selected);
  const items =
    selected === 'planning'
      ? planningProblems.map((problem) => ({
          key: problem.key,
          title: problem.title,
          url: `/lessons/planning?algorithm=${problem.id}`,
        }))
      : topic
        ? [{ key: topic.slug, title: topic.title, url: `/lessons/${topic.slug}` }]
        : [];
  return (
    <>
      <main id="main" className={`canvas-page ${collapsed ? 'overlay-collapsed' : ''}`}>
        <div
          ref={canvas}
          id="roadmap-canvas"
          className={dragClass}
          tabIndex={0}
          role="region"
          aria-label="Interactive robotics roadmap. Drag to pan, scroll to zoom. Arrow keys pan; plus and minus zoom; F resets the view."
          data-zoom={view.scale.toFixed(3)}
          style={{
            backgroundPosition: `${view.x}px ${view.y}px`,
            backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`,
            backgroundImage: `radial-gradient(circle, #343237 ${view.scale}px, transparent ${view.scale}px)`,
          }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault();
              const v = viewRef.current;
              applyView({
                ...v,
                x: v.x + (event.key === 'ArrowLeft' ? -45 : event.key === 'ArrowRight' ? 45 : 0),
                y: v.y + (event.key === 'ArrowUp' ? -45 : event.key === 'ArrowDown' ? 45 : 0),
              });
            } else if (['+', '=', '-'].includes(event.key)) {
              event.preventDefault();
              zoom(event.key === '-' ? 1 / 1.2 : 1.2);
            } else if (event.key.toLowerCase() === 'f') {
              event.preventDefault();
              fit(true);
            }
          }}
        >
          <div
            id="roadmap-world"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          >
            <svg
              id="lesson-graph"
              width="1200"
              height="810"
              role="img"
              aria-labelledby="graph-title graph-description"
            >
              <title id="graph-title">Robotics lesson relationships</title>
              <desc id="graph-description">
                Geometry branches into Planning and Control. Both lead to Estimation. Hardware and
                Tooling are supporting branches. Estimation leads to Machine Learning, Reinforcement
                Learning, VLAs, and Computer Vision.
              </desc>
              <g id="roadmap-edges">
                {connections.map(([from, to, supporting]) => (
                  <path
                    key={`${from}-${to}`}
                    data-from={from}
                    data-to={to}
                    className={supporting ? 'support-edge' : ''}
                    d={edgePath(from, to)}
                    style={{
                      display:
                        visible(topicMap.get(from)!) && visible(topicMap.get(to)!)
                          ? undefined
                          : 'none',
                    }}
                  />
                ))}
              </g>
            </svg>
            <div id="roadmap-nodes">
              {topics.map((topic) => {
                const amount = topicProgress(topic, progress),
                  done = amount.done === amount.total,
                  p = positions[topic.slug],
                  star =
                    progress.starred.includes(topic.slug) ||
                    topicItems(topic).some((key) => progress.starred.includes(key));
                return (
                  <button
                    key={topic.slug}
                    data-topic={topic.slug}
                    className={`roadmap-node ${done ? 'completed' : ''} ${selected === topic.slug ? 'selected' : ''}`}
                    hidden={!visible(topic)}
                    style={{ width: topic.w, height: topic.h, left: p.x, top: p.y }}
                    aria-label={`${topic.title}, ${amount.done} of ${amount.total} complete`}
                    title={`${topic.title} (${amount.done}/${amount.total})`}
                    onClick={() => {
                      if (performance.now() >= blockClickUntil.current) setSelected(topic.slug);
                    }}
                  >
                    <h3>
                      {topic.lines.map((line, i) => (
                        <Fragment key={line}>
                          {i > 0 && <br />}
                          {line}
                        </Fragment>
                      ))}
                    </h3>
                    <span className="node-progress" aria-hidden="true">
                      <i style={{ width: `${(100 * amount.done) / amount.total}%` }} />
                    </span>
                    <span className="node-star" aria-hidden="true" hidden={!star}>
                      ★
                    </span>
                    <span className="node-complete-icon" aria-hidden="true" hidden={!done}>
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p id="empty-filter" hidden={shown.length > 0}>
            No topics in this view.
          </p>
        </div>
        <div className="canvas-controls" role="group" aria-label="Canvas controls">
          <button id="zoom-in" aria-label="Zoom in" onClick={() => zoom(1.2)}>
            +
          </button>
          <button id="zoom-out" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
            −
          </button>
          <button id="fit-view" aria-label="Reset graph position" onClick={() => fit(true)}>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <button
          id="overlay-toggle"
          className="overlay-toggle"
          aria-label="Toggle progress overlay"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          Progress{' '}
          <span id="mini-progress">
            {count} / {completionItems.length}
          </span>
          <span aria-hidden="true">▦</span>
        </button>
        <div ref={overlayRef} style={{ display: 'contents' }}>
          <ProgressOverlay
            progress={progress}
            filter={filter}
            setFilter={setFilter}
            hide={() => setCollapsed(true)}
            random={() => {
              const unfinished = topics.filter((topic) => !completed(topic));
              if (unfinished.length)
                setSelected(unfinished[Math.floor(Math.random() * unfinished.length)].slug);
              else setMessage('All topics are marked complete.');
            }}
            restore={() => fit(true)}
            reset={() => setDialog('reset')}
            help={() => setDialog('help')}
          />
        </div>
      </main>
      <Modal
        id="topic-drawer"
        className="topic-drawer"
        labelledBy="drawer-title"
        open={!!topic}
        close={() => setSelected(null)}
      >
        <button
          id="drawer-close"
          className="drawer-close"
          aria-label="Close lesson sidebar"
          onClick={() => setSelected(null)}
        >
          ×
        </button>
        <h1 id="drawer-title">{topic?.title}</h1>
        <p id="drawer-count" className="drawer-count">
          {topic &&
            `(${topicProgress(topic, progress).done} / ${topicProgress(topic, progress).total})`}
        </p>
        <section id="prerequisite-section" hidden={!incoming.length}>
          <h2 id="prerequisite-heading">
            {incoming.every(([, , support]) => support) ? 'Supporting connection' : 'Prerequisites'}
          </h2>
          <div id="prerequisite-links">
            {incoming.map(([from, , support]) => (
              <button key={from} onClick={() => setSelected(from)}>
                {topicMap.get(from)!.title}
                <small>{support ? 'Related topic' : 'Robotics 101'}</small>
              </button>
            ))}
          </div>
        </section>
        <div className="lesson-table-wrap">
          <table className="roadmap-lesson-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Star</th>
                <th>Lesson</th>
              </tr>
            </thead>
            <tbody id="lesson-rows">
              {items.map((item) => {
                const starred = progress.starred.includes(item.key);
                return (
                  <tr key={item.key}>
                    <td>
                      <input
                        type="checkbox"
                        className="lesson-complete"
                        checked={!!progress.completed[item.key]}
                        aria-label={`Mark ${item.title} complete`}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          persist((previous) => {
                            const completed = { ...previous.completed };
                            if (checked) completed[item.key] = localDay();
                            else delete completed[item.key];
                            return { ...previous, completed };
                          });
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="lesson-star"
                        aria-label={`${starred ? 'Unstar' : 'Star'} ${item.title}`}
                        aria-pressed={starred}
                        onClick={() =>
                          persist((previous) => ({
                            ...previous,
                            starred: starred
                              ? previous.starred.filter((key) => key !== item.key)
                              : [...previous.starred, item.key],
                          }))
                        }
                      >
                        {starred ? '★' : '☆'}
                      </button>
                    </td>
                    <td>
                      <Link to={item.url}>{item.title}</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="empty-content-note">
          {selected === 'planning'
            ? 'Four runnable Python problems. Each has three grid cases. Submit checks every case.'
            : "Lesson content hasn't been added yet. Completion is marked manually."}
        </p>
      </Modal>
      <Modal
        id="help-dialog"
        className="roadmap-dialog"
        labelledBy="help-title"
        open={dialog === 'help'}
        close={() => setDialog(null)}
      >
        <h2 id="help-title">Explore the roadmap</h2>
        <p>
          Drag the background to pan. Scroll or use + / − to zoom. Drag a node to rearrange it.
          Reset restores the original layout.
        </p>
        <p>
          Click a topic to open its lesson sidebar. Mark completion or star a topic there. Progress
          is saved in this browser; opening a lesson does not mark it complete.
        </p>
        <p>
          Keyboard: arrow keys pan the focused canvas, + / − zoom, F resets the view, and Escape
          closes a sidebar or dialog.
        </p>
        <button id="help-close" className="dialog-button" onClick={() => setDialog(null)}>
          Got it
        </button>
      </Modal>
      <Modal
        id="reset-dialog"
        className="roadmap-dialog"
        labelledBy="reset-title"
        open={dialog === 'reset'}
        close={() => setDialog(null)}
      >
        <h2 id="reset-title">Reset learning progress?</h2>
        <p>This clears completion dates and stars saved in this browser.</p>
        <div className="dialog-actions">
          <button id="reset-cancel" className="dialog-button" onClick={() => setDialog(null)}>
            Cancel
          </button>
          <button
            id="reset-confirm"
            className="dialog-button danger"
            onClick={() => {
              persist(() => ({ completed: {}, starred: [] }));
              setDialog(null);
              setMessage('Learning progress reset.');
            }}
          >
            Reset progress
          </button>
        </div>
      </Modal>
      <div
        id="roadmap-notice"
        role="status"
        aria-live="polite"
        className={message ? 'visible' : ''}
      >
        {message}
      </div>
    </>
  );
}

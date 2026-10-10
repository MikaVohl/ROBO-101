import { useState } from 'react';
import type { Progress } from '../../shared/types';
import { topics } from '../../shared/curriculum';
import { completionItems, localDay, progressGroups, topicItems } from '../../shared/progress';
export type TopicFilter = 'all' | 'incomplete' | 'starred';
export function ProgressOverlay({
  progress,
  filter,
  setFilter,
  hide,
  random,
  restore,
  reset,
  help,
}: {
  progress: Progress;
  filter: TopicFilter;
  setFilter: (value: TopicFilter) => void;
  hide: () => void;
  random: () => void;
  restore: () => void;
  reset: () => void;
  help: () => void;
}) {
  const count = completionItems.filter((key) => progress.completed[key]).length;
  const [calendar, setCalendar] = useState(true);
  const circumference = 2 * Math.PI * 48;
  let offset = 0;
  const groups = progressGroups.map((group) => {
    const items = topics.filter(group.includes).flatMap(topicItems);
    const done = items.filter((key) => progress.completed[key]).length;
    const arc = (circumference * items.length) / completionItems.length - 6;
    const start = offset + 3;
    offset += arc + 6;
    return { ...group, total: items.length, done, arc, start, filled: (arc * done) / items.length };
  });
  return (
    <aside id="progress-overlay" className="progress-overlay" aria-label="Learning progress">
      <section className="progress-card">
        <button
          id="hide-overlay"
          className="hide-overlay"
          aria-label="Hide progress overlay"
          onClick={hide}
        >
          −
        </button>
        <div className="progress-summary">
          <div id="progress-counts" className="progress-counts">
            {groups.map((group) => (
              <div key={group.label} className="progress-count-row">
                <strong style={{ color: group.color }}>{group.label}</strong>
                <span>
                  {group.done}/{group.total}
                </span>
              </div>
            ))}
          </div>
          <div
            id="progress-ring"
            className="progress-ring"
            role="img"
            aria-label={`${count} of ${completionItems.length} items complete`}
          >
            <svg viewBox="0 0 128 128" aria-hidden="true" id="ring-segments">
              {groups.map((group) => (
                <g key={group.label}>
                  <circle
                    cx="64"
                    cy="64"
                    r="48"
                    fill="none"
                    stroke={group.color}
                    strokeOpacity=".2"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${group.arc} ${circumference - group.arc}`}
                    strokeDashoffset={-group.start}
                    transform="rotate(-90 64 64)"
                  />
                  {group.done > 0 && (
                    <circle
                      cx="64"
                      cy="64"
                      r="48"
                      fill="none"
                      stroke={group.color}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${group.filled} ${circumference - group.filled}`}
                      strokeDashoffset={-group.start}
                      transform="rotate(-90 64 64)"
                    />
                  )}
                  <circle
                    cx={64 + 48 * Math.cos(group.start / 48 - Math.PI / 2)}
                    cy={64 + 48 * Math.sin(group.start / 48 - Math.PI / 2)}
                    r="3"
                    fill={group.color}
                  />
                </g>
              ))}
            </svg>
            <div className="ring-center">
              <strong id="total-complete">{count}</strong>
              <span>/ {completionItems.length}</span>
              <small>Complete</small>
            </div>
          </div>
        </div>
        <div className="roadmap-picker">
          <label className="visually-hidden" htmlFor="topic-filter">
            Roadmap view
          </label>
          <span aria-hidden="true">🤖</span>
          <select
            id="topic-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as TopicFilter)}
          >
            <option value="all">Robotics 101</option>
            <option value="incomplete">Incomplete topics</option>
            <option value="starred">Starred topics</option>
          </select>
        </div>
        <div className="progress-tools" role="group" aria-label="Progress tools">
          <button id="random-topic" aria-label="Open an incomplete lesson" onClick={random}>
            ⤨
          </button>
          <button id="restore-layout" aria-label="Restore roadmap layout" onClick={restore}>
            ⟳
          </button>
          <button id="clear-progress" aria-label="Reset learning progress" onClick={reset}>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7m4-7v7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button id="roadmap-help" aria-label="Roadmap help" onClick={help}>
            ?
          </button>
          <button
            id="toggle-calendar"
            aria-label="Toggle activity calendar"
            onClick={() => setCalendar((value) => !value)}
          >
            <svg viewBox="0 0 24 24" fill="none">
              <rect
                x="4"
                y="5"
                width="16"
                height="15"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path d="M8 3v4m8-4v4M4 10h16" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </section>
      <ActivityCalendar progress={progress} hidden={!calendar} />
    </aside>
  );
}
function thisMonth() {
  const month = new Date(`${localDay()}T12:00:00Z`);
  month.setUTCDate(1);
  return month;
}
function ActivityCalendar({ progress, hidden }: { progress: Progress; hidden: boolean }) {
  const [month, setMonth] = useState(thisMonth);
  const today = localDay(),
    year = month.getUTCFullYear(),
    index = month.getUTCMonth();
  const activity = new Set(Object.values(progress.completed));
  const firstWeekday = new Date(Date.UTC(year, index, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  let best = 0,
    sequence = 0,
    previous: number | null = null;
  for (const day of [...activity].sort()) {
    const value = Date.parse(`${day}T00:00:00Z`);
    sequence = previous !== null && value - previous === 86400000 ? sequence + 1 : 1;
    best = Math.max(best, sequence);
    previous = value;
  }
  let current = 0,
    value = Date.parse(`${today}T00:00:00Z`);
  if (!activity.has(today)) value -= 86400000;
  while (activity.has(new Date(value).toISOString().slice(0, 10))) {
    current++;
    value -= 86400000;
  }
  const change = (delta: number) => setMonth(new Date(Date.UTC(year, index + delta, 1, 12)));
  return (
    <section
      id="activity-card"
      className="activity-card"
      aria-label="Learning activity calendar"
      hidden={hidden}
    >
      <div className="calendar-header">
        <button id="month-prev" aria-label="Previous month" onClick={() => change(-1)}>
          ‹
        </button>
        <h2 id="calendar-month">
          {new Intl.DateTimeFormat('en-US', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(month)}
        </h2>
        <button id="month-next" aria-label="Next month" onClick={() => change(1)}>
          ›
        </button>
      </div>
      <div className="calendar-caption">
        <button
          id="month-today"
          title="Return to current month"
          onClick={() => setMonth(thisMonth())}
        >
          Day {Number(today.slice(-2))}
        </button>
        <span>Learning activity</span>
      </div>
      <div className="calendar-weekdays" aria-hidden="true">
        {'SMTWTFS'.split('').map((day, i) => (
          <span key={i}>{day}</span>
        ))}
      </div>
      <div id="calendar-days" className="calendar-days">
        {Array.from({ length: firstWeekday }, (_, i) => (
          <span key={`blank${i}`} />
        ))}
        {Array.from({ length }, (_, i) => {
          const day = i + 1,
            key = `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          return (
            <span
              key={key}
              className={`${key === today ? 'today' : ''} ${activity.has(key) ? 'activity' : ''}`}
              aria-label={`${key}${key === today ? ', today' : ''}${activity.has(key) ? ', learning completed' : ''}`}
              aria-current={key === today ? 'date' : undefined}
            >
              {day}
            </span>
          );
        })}
      </div>
      <div className="streak-row">
        <div>
          <span>Current streak</span>
          <strong>
            <i aria-hidden="true">♨</i>
            <b id="current-streak">{current}</b> <small>days</small>
          </strong>
        </div>
        <div>
          <span>Best streak</span>
          <strong>
            <i aria-hidden="true">⚡</i>
            <b id="best-streak">{best}</b> <small>days</small>
          </strong>
        </div>
      </div>
      <p className="local-progress-note">Your progress stays in this browser.</p>
    </section>
  );
}

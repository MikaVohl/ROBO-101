import { useEffect, useRef } from 'react';
import type { GridCase, Visual } from '../../shared/types';
export function Grid({ test, visual }: { test?: GridCase; visual: Visual }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!test || !canvas.current) return;
    const node = canvas.current;
    const draw = () => drawGrid(node, test, visual);
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(node);
    return () => observer.disconnect();
  }, [test, visual]);
  return (
    <canvas
      ref={canvas}
      id="planning-grid"
      role="img"
      aria-label="Grid visualization with start, goal, obstacles, frontier, and visited cells"
    />
  );
}
function drawGrid(gridCanvas: HTMLCanvasElement, test: GridCase, visual: Visual) {
  const ctx = gridCanvas.getContext('2d');
  if (!ctx) return;
  const rect = gridCanvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio, 2);
  gridCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  gridCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rows = test.grid.length,
    cols = test.grid[0].length,
    cell = Math.min(rect.width / cols, rect.height / rows),
    x0 = (rect.width - cols * cell) / 2,
    y0 = (rect.height - rows * cell) / 2;
  const visited = new Set(visual.visited.map((c) => c.join(','))),
    frontier = new Set(visual.frontier.map((c) => c.join(','))),
    path = new Set(visual.path.map((c) => c.join(',')));
  ctx.clearRect(0, 0, rect.width, rect.height);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const value = test.grid[r][c],
        key = `${r},${c}`;
      let fill = value === 0 ? '#4a4c55' : value > 1 ? '#63482e' : '#242830';
      if (value > 0 && visited.has(key)) fill = '#2b5266';
      if (value > 0 && frontier.has(key)) fill = '#6d5988';
      if (path.has(key)) fill = '#adc8bd';
      const isStart = r === test.start[0] && c === test.start[1],
        isGoal = r === test.goal[0] && c === test.goal[1];
      if (isStart) fill = '#139e84';
      if (isGoal) fill = '#bd695f';
      ctx.fillStyle = fill;
      ctx.fillRect(x0 + c * cell + 1, y0 + r * cell + 1, cell - 2, cell - 2);
      if (value > 1 && !isStart && !isGoal) {
        ctx.fillStyle = '#d5b184';
        ctx.font = `${Math.max(7, cell * 0.35)}px ui-monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell);
      }
      if (isStart || isGoal) {
        ctx.fillStyle = '#effaf5';
        ctx.font = `600 ${Math.max(8, cell * 0.45)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isStart ? 'S' : 'G', x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell);
      }
    }
  if (visual.path.length) {
    ctx.strokeStyle = '#dcece4';
    ctx.lineWidth = Math.max(1.5, cell * 0.13);
    ctx.beginPath();
    visual.path.forEach(([r, c], i) => {
      const x = x0 + (c + 0.5) * cell,
        y = y0 + (r + 0.5) * cell;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  if (visual.current) {
    const [r, c] = visual.current;
    ctx.fillStyle = '#ffd77b';
    ctx.beginPath();
    ctx.arc(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, Math.max(3, cell * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
  gridCanvas.setAttribute(
    'aria-label',
    `${test.name}: ${visited.size} explored, ${frontier.size} in frontier, ${visual.path.length ? visual.path.length - 1 + ' path moves' : 'no final path'}. Start ${test.start.join(',')}; goal ${test.goal.join(',')}.`,
  );
}

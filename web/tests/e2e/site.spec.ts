import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StateMessage } from '../../src/features/simulation/types';
const faults: string[] = [];
test.beforeEach(async ({ page }) => {
  faults.length = 0;
  page.on('pageerror', (error) => faults.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) faults.push(`${response.status()} ${response.url()}`);
  });
});
test.afterEach(() => expect(faults).toEqual([]));
async function planning(page: Page, algorithm = 'dfs') {
  await page.goto(`/lessons/planning?algorithm=${algorithm}`);
  await expect(page.locator('#python-status')).toHaveText('Python ready', { timeout: 45000 });
  await expect(page.locator('#code-editor')).toHaveClass(/ace_editor/);
}
async function range(page: Page, id: string, value: string) {
  await page.locator(id).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function replaceCode(page: Page, source: string) {
  await page
    .getByRole('textbox', { name: /Python solution editor/ })
    .filter({ visible: true })
    .focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}
test('landing simulation, SPA navigation, empty lessons, and graph relationships', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#hero-status')).toHaveText('Live simulation');
  await expect(page.locator('#hero-viewport canvas')).toBeVisible();
  await page.locator('#hero-pause').click();
  await expect(page.locator('#hero-status')).toHaveText('Paused');
  await page.locator('.hero-actions a[href="/roadmap"]').click();
  await expect(page.locator('.roadmap-node')).toHaveCount(11);
  await expect(
    page.locator('path[data-from="geometry-kinematics"][data-to="planning"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('path[data-from="geometry-kinematics"][data-to="control"]'),
  ).toHaveCount(1);
  await expect(page.locator('path[data-from="planning"][data-to="control"]')).toHaveCount(0);
  await expect(page.locator('path[data-from="planning"][data-to="estimation"]')).toHaveCount(1);
  await expect(page.locator('path[data-from="control"][data-to="estimation"]')).toHaveCount(1);
  await page.locator('[data-topic="simulation-anatomy"]').click();
  await page.locator('#lesson-rows a').click();
  await expect(page.locator('.empty-lesson')).toContainText(
    "Lesson content hasn't been added yet.",
  );
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.locator('#hero-status')).toHaveText('Live simulation');
});
test('home arm sorts randomized blocks and adapts to live scene edits', async ({ page }) => {
  let frame: StateMessage | undefined;
  page.on('websocket', (socket) =>
    socket.on('framereceived', (event) => {
      const message = JSON.parse(String(event.payload)) as StateMessage;
      if (message.type === 'state' && message.scene === 'sorting') frame = message;
    }),
  );
  await page.goto('/');
  await expect(page.locator('.simulation-name')).toHaveText('Reactive sorting');
  await expect(page.locator('#hero-status')).toHaveText('Live simulation');
  await page.locator('#hero-pause').click();
  await expect(page.locator('#hero-status')).toHaveText('Paused');
  const paused = frame!.time;
  await page.locator('#hero-add-block').click();
  await expect.poll(() => frame?.task?.active?.length).toBe(4);
  expect(frame!.time).toBe(paused);
  expect(frame!.hidden_geoms).toHaveLength(2);
  await page.locator('#hero-pause').click();
  await expect(page.locator('#hero-task-phase')).toHaveText('Aligning');
  const replans = frame?.task?.replans ?? 0;
  await page.locator('#hero-move-block').click();
  await expect.poll(() => frame?.task?.replans).toBeGreaterThan(replans);
  await expect.poll(() => frame?.task?.sorted, { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#hero-sort-count')).not.toHaveText('0 sorted');
  expect(frame?.arm?.position).toHaveLength(6);
  expect(frame?.car).toBeUndefined();
  await page.locator('#hero-pause').click();
  await expect(page.locator('#hero-status')).toHaveText('Paused');
  const finished = frame!.time;
  await page.waitForTimeout(150);
  expect(frame!.time).toBe(finished);
});
test('reduced-motion home demo starts paused and resumes on request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#hero-status')).toHaveText('Paused');
  await expect(page.locator('#hero-task-phase')).toHaveText('Looking');
  await page.locator('#hero-pause').click();
  await expect(page.locator('#hero-status')).toHaveText('Live simulation');
  await expect(page.locator('#hero-task-phase')).not.toHaveText('Looking');
});
test('roadmap pan, zoom, node dragging, progress, stars, filters and persistence', async ({
  page,
}) => {
  await page.goto('/roadmap');
  const canvas = page.locator('#roadmap-canvas');
  const beforeZoom = await canvas.getAttribute('data-zoom');
  await page.locator('#zoom-in').click();
  await expect(canvas).not.toHaveAttribute('data-zoom', beforeZoom!);
  await page.locator('#fit-view').click();
  const node = page.locator('[data-topic="planning"]'),
    before = await node.getAttribute('style'),
    rect = await node.boundingBox();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width / 2 + 35, rect!.y + rect!.height / 2 + 25, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(node).not.toHaveAttribute('style', before!);
  await page.locator('#fit-view').click();
  await page.waitForTimeout(300);
  const world = page.locator('#roadmap-world'),
    transform = await world.getAttribute('style');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(world).not.toHaveAttribute('style', transform!);
  await node.click();
  await page.getByRole('checkbox', { name: 'Mark Depth-First Search complete' }).check();
  await page.getByRole('button', { name: 'Star Depth-First Search', exact: true }).click();
  await expect(page.locator('#drawer-count')).toHaveText('(1 / 4)');
  await page.locator('#drawer-close').click();
  await expect(page.locator('#mini-progress')).toHaveText('1 / 14');
  await page.locator('#topic-filter').selectOption('starred');
  await expect(page.locator('.roadmap-node:visible')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#mini-progress')).toHaveText('1 / 14');
});
test('wheel zoom keeps the background grid and graph aligned at the pointer', async ({ page }) => {
  await page.goto('/roadmap');
  const canvas = page.locator('#roadmap-canvas');
  const rect = (await canvas.boundingBox())!;
  const point = {
    x: Math.round(rect.x + rect.width * 0.4) - rect.x,
    y: Math.round(rect.y + rect.height * 0.45) - rect.y,
  };
  const transform = async () =>
    page.locator('#roadmap-world').evaluate((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
  const before = await transform();
  await page.mouse.move(rect.x + point.x, rect.y + point.y);
  await page.mouse.wheel(0, -180);
  await expect(canvas).not.toHaveAttribute('data-zoom', before.scale.toFixed(3));
  const after = await transform();
  expect((point.x - after.x) / after.scale).toBeCloseTo((point.x - before.x) / before.scale, 2);
  expect((point.y - after.y) / after.scale).toBeCloseTo((point.y - before.y) / before.scale, 2);
  const background = await canvas.evaluate((element) => {
    const css = getComputedStyle(element);
    return {
      size: parseFloat(css.backgroundSize),
      x: parseFloat(css.backgroundPositionX),
      y: parseFloat(css.backgroundPositionY),
    };
  });
  expect(background.size).toBeCloseTo(22 * after.scale, 2);
  expect(background.x).toBeCloseTo(after.x, 2);
  expect(background.y).toBeCloseTo(after.y, 2);
});
test('all four editable Python solutions submit all three cases and update roadmap', async ({
  page,
}) => {
  await planning(page);
  for (const algorithm of ['dfs', 'bfs', 'dijkstra', 'astar']) {
    await page.locator(`[data-algorithm="${algorithm}"]`).click();
    await page.locator('#submit-code').click();
    await expect(page.locator('#result-status')).toHaveText('Accepted · 3 / 3');
    await expect(page.locator('#test-results button.passed')).toHaveCount(3);
  }
  await expect(page.locator('#problem-progress')).toHaveText('4 / 4 complete');
  await page.getByRole('link', { name: '← Roadmap', exact: true }).click();
  await page.locator('[data-topic="planning"]').click();
  await expect(page.locator('#drawer-count')).toHaveText('(4 / 4)');
});
test('run animates, pauses, steps, replays and changes grid cases', async ({ page }) => {
  await planning(page, 'astar');
  await page.locator('[data-case="1"]').click();
  await page.locator('#run-code').click();
  await expect(page.locator('#step-counter')).not.toHaveText('Step 0');
  await page.locator('#pause-run').click();
  await expect(page.locator('#grid-status')).toHaveText('Paused');
  await page.waitForTimeout(150);
  const step = await page.locator('#step-counter').textContent();
  await page.locator('#step-run').click();
  await expect(page.locator('#step-counter')).not.toHaveText(step!);
  await range(page, '#playback-speed', '100');
  await page.locator('#pause-run').click();
  await expect(page.locator('#result-status')).toHaveText('Passed');
  await expect(page.locator('#path-cost')).toHaveText('26');
  await page.locator('#replay-run').click();
  await expect(page.locator('#grid-status')).toHaveText('Replaying');
  await page.locator('#pause-run').click();
  await expect(page.locator('#grid-status')).toHaveText('Replay paused');
  await page.locator('[data-case="2"]').click();
  await page.locator('#run-code').click();
  await expect(page.locator('#result-status')).toHaveText('Passed');
  await expect(page.locator('#grid-status')).toHaveText('No path');
});
test('edited code runs, drafts survive navigation, and infinite loops can be stopped', async ({
  page,
}) => {
  await planning(page);
  const source =
    'def solve(grid, start, goal):\n    print("react_migration_edit")\n    return []\n';
  await replaceCode(page, source);
  await page.locator('#run-code').click();
  await expect(page.locator('#result-status')).toHaveText('Wrong answer');
  await expect(page.locator('#console-output')).toContainText('react_migration_edit');
  await page.locator('[data-algorithm="bfs"]').click();
  await page.locator('[data-algorithm="dfs"]').click();
  await page.getByRole('link', { name: '← Roadmap', exact: true }).click();
  await page.locator('[data-topic="planning"]').click();
  await page.locator('#lesson-rows a').first().click();
  await expect(page.locator('#code-editor')).toContainText('react_migration_edit');
  await expect(page.locator('#python-status')).toHaveText('Python ready');
  await replaceCode(page, 'def solve(grid, start, goal):\n    while True:\n        pass\n');
  await page.locator('#run-code').click();
  await page.locator('#stop-code').click();
  await expect(page.locator('#result-status')).toHaveText('Stopped');
  await expect(page.locator('#python-status')).toHaveText('Python ready');
  await page.locator('#reset-code').click();
  await page.locator('#submit-code').click();
  await expect(page.locator('#result-status')).toHaveText('Accepted · 3 / 3');
});
test('simulator scenes, arm controls, driving, pausing and reset', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.locator('#connection')).toContainText('Physics connected');
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await expect(page.locator('#joints input')).toHaveCount(6);
  await range(page, '#joint-0', '30');
  await expect(page.locator('#joint-0-value')).toHaveText('30°');
  await page.locator('#gripper').click();
  await expect(page.locator('#gripper')).toHaveText('Open fingers');
  await page.locator('[data-scene="car"]').click();
  await expect(page.locator('#arm-controls')).toBeHidden();
  await range(page, '#speed', '0.3');
  await expect(page.locator('#speed-value')).toContainText('0.30');
  await page.locator('#stop').click();
  await expect(page.locator('#speed-value')).toContainText('0.00');
  await page.locator('#pause').click();
  await expect(page.locator('#run-label')).toHaveText('PAUSED');
  await page.locator('#reset').click();
  await expect(page.locator('#run-label')).toHaveText('RUNNING');
  await page.locator('[data-scene="arm"]').click();
  await expect(page.locator('#car-controls')).toBeHidden();
});
test('mobile roadmap overlay and planning workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/roadmap');
  await expect(page.locator('#progress-overlay')).toBeHidden();
  await page.locator('#overlay-toggle').click();
  await expect(page.locator('#progress-overlay')).toBeVisible();
  await page.locator('#hide-overlay').click();
  await planning(page);
  await expect(page.locator('#planning-grid')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

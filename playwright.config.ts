import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './web/tests/e2e',
  outputDir: process.env.ROBO_E2E_URL ? 'test-results/dev' : 'test-results/production',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.ROBO_E2E_URL ?? 'http://127.0.0.1:8001',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.ROBO_E2E_URL
    ? undefined
    : {
        command: 'uv run robo-web --port 8001',
        url: 'http://127.0.0.1:8001/health',
        reuseExistingServer: false,
      },
});

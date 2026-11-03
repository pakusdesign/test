import { defineConfig, devices } from '@playwright/test';

const SERVER_PORT = 3101;
const CLIENT_PORT = 5174;

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright-report.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
    launchOptions: {
      // Фиктивное устройство Chromium: настоящий MediaRecorder и Web Audio без реального микрофона.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'evidence', testDir: 'tests/evidence', fullyParallel: false, workers: 1 },
  ],
  webServer: [
    {
      command: 'npx tsx src/server/index.ts',
      env: { APP_MODE: 'demo', PORT: String(SERVER_PORT), HOST: '127.0.0.1', RATE_LIMIT_PER_MINUTE: '1000' },
      url: `http://127.0.0.1:${SERVER_PORT}/api/config`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${CLIENT_PORT} --strictPort`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${SERVER_PORT}`, CLIENT_PORT: String(CLIENT_PORT) },
      url: `http://127.0.0.1:${CLIENT_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

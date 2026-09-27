import { defineConfig } from '@playwright/test';

// App-level e2e tests against the static export (`pnpm build` first), served by our own
// zero-dependency server on port 4317. Installed Chrome gives real H.264 WebCodecs encoding.
// Run through research/heavy.sh with --workers=2 or fewer.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: { baseURL: 'http://127.0.0.1:4317', trace: 'retain-on-failure', acceptDownloads: true },
  webServer: { command: 'node scripts/serve-static.mjs out 4317', port: 4317, reuseExistingServer: true },
  projects: [{ name: 'chrome', use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 1280, height: 900 } } }],
});

import { defineConfig } from '@playwright/test';

// Verifier-only Playwright config. Serves the production static export (apps/web/out) on 4319.
// Run through scripts/verify/e2e.sh (which goes through research/heavy.sh). Headless only;
// never the Claude in-app browser.
//   VERIFY_SUITE=app  → the builders' apps/web/tests/e2e specs (for the cross-engine run)
//   default           → scripts/verify/e2e/*.spec.ts (verifier's own checks)
const app = process.env.VERIFY_SUITE === 'app';
// The builders' specs hard-code origin 127.0.0.1:4317, so the app suite uses that port.
const PORT = app ? 4317 : 4319;
export default defineConfig({
  testDir: app ? '../../apps/web/tests/e2e' : 'e2e',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: `../../test-results/verify/pw-${process.env.VERIFY_TAG ?? 'run'}.json` }]],
  outputDir: '../../test-results/verify/pw-out',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', acceptDownloads: true, viewport: { width: 1280, height: 900 } },
  webServer: { command: `node ../../apps/web/scripts/serve-static.mjs ../../apps/web/out ${PORT}`, port: PORT, reuseExistingServer: false },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    // Real installed Firefox driven over WebDriver BiDi (Playwright's `moz-firefox` channel).
    { name: 'firefox', use: { browserName: 'firefox', channel: 'moz-firefox' } },
    // Playwright's WebKit build (only if `playwright install webkit` has been run).
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});

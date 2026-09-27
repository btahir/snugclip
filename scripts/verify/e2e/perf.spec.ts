// Verifier: ACCEPTANCE K1/K2. F14 (60 s 1080p30) → 10 MB through the UI, 3 runs, median ≤ 90 s,
// and no main-thread long task > 100 ms between Start (drop) and ready. Headless installed Chrome.
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test.skip(({ browserName }) => browserName !== 'chromium', 'perf is measured in Chrome');
test.setTimeout(900_000);
const F14 = fileURLToPath(new URL('../../../fixtures/generated/f14-perf-1080p30-60s.mp4', import.meta.url));

test('K1/K2: F14 → 10 MB, 3 runs', async ({ browser }) => {
  const runs: { s: number; bytes: number; attempts: number; maxLongTask: number; longTasks: number; ssim: number; res: string; encoder: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (window as any).__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__lt.push({ d: e.duration, t: e.startTime }); }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto('http://127.0.0.1:4319/?size=10MB');
    await page.waitForSelector('#tool[data-support="ok"]', { timeout: 30_000 });
    await page.waitForTimeout(1000);
    const tStart = await page.evaluate(() => performance.now());
    const t0 = Date.now();
    await page.setInputFiles('[data-testid="file-input"]', F14);
    await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 300_000 });
    const s = (Date.now() - t0) / 1000;
    const lt = (await page.evaluate(() => (window as any).__lt)) as { d: number; t: number }[];
    const during = lt.filter((x) => x.t >= tStart);
    const r = await page.evaluate(() => (window as any).__snugclip.state().items[0].report);
    runs.push({ s, bytes: r.output.bytes, attempts: r.attempts.length, maxLongTask: Math.round(Math.max(0, ...during.map((x) => x.d))), longTasks: during.length, ssim: r.quality?.ssimMean, res: `${r.output.video.width}x${r.output.video.height}@${r.output.video.fps}`, encoder: r.engine?.encoder });
    console.log(`K run ${i + 1}: ${JSON.stringify(runs.at(-1))}`);
    expect(r.output.bytes).toBeLessThanOrEqual(10_000_000);
    await ctx.close();
  }
  const sorted = runs.map((r) => r.s).sort((a, b) => a - b);
  const median = sorted[1]!;
  const maxLT = Math.max(...runs.map((r) => r.maxLongTask));
  console.log(`K1 median ${median.toFixed(1)} s (budget 90 s); K2 max long task ${maxLT} ms (budget 100 ms)`);
  expect(median).toBeLessThanOrEqual(90);
  expect(maxLT).toBeLessThanOrEqual(100);
});

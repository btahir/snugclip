import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { drop, fx, items, ready, sha256, size } from './helpers';

test('compresses a 60 s 1080p clip under 10 MB end to end, with preview, badge and download', async ({ page }) => {
  const longTasks: number[] = [];
  await page.goto('/?size=10MB');
  await ready(page);
  await page.evaluate(() => {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) ((window as any).__lt ??= []).push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  });
  const t0 = Date.now();
  await drop(page, [fx('f14-perf-1080p30-60s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 200_000 });
  const elapsed = (Date.now() - t0) / 1000;
  longTasks.push(...((await page.evaluate(() => (window as any).__lt ?? [])) as number[]));
  const [it] = await items(page);
  const r = it!.report!;
  console.log(
    `F14 → 10 MB: ${r.output.bytes} bytes, ${r.output.video.width}x${r.output.video.height}@${r.output.video.fps}, ` +
      `${r.attempts.length} encodes, SSIM ${r.quality?.ssimMean?.toFixed(4)} (${r.quality?.label}), ${elapsed.toFixed(1)} s, max long task ${Math.max(0, ...longTasks).toFixed(0)} ms`,
  );
  expect(r.status).toBe('fit');
  expect(r.output.bytes).toBeLessThanOrEqual(10_000_000);
  expect(r.output.bytes).toBeGreaterThan(8_000_000);
  await expect(page.getByTestId('result-size')).toContainText('MB');
  await expect(page.getByTestId('quality')).toBeVisible();
  await expect(page.getByTestId('compare')).toBeVisible();
  await expect(page.getByTestId('meter')).toHaveAttribute('aria-label', /under the 10 MB limit/);

  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('f14-perf-1080p30-60s-snug-10MB.mp4');
  const path = await d.path();
  expect(size(path)).toBe(r.output.bytes);
  expect(size(path)).toBeLessThanOrEqual(10_000_000);

  // Moment-of-value support card: once per session, never a dialog.
  const card = page.getByTestId('support-card');
  await expect(card).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  const dl2 = page.waitForEvent('download');
  await page.getByTestId('download').click();
  await dl2;
  await expect(page.getByTestId('support-card')).toHaveCount(0);
});

test('a file already under the target is handed back byte-identical', async ({ page }) => {
  await page.goto('/?size=10MB');
  await ready(page);
  await drop(page, [fx('f12-tiny-360p-5s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Untouched original').first()).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('f12-tiny-360p-5s.mp4');
  expect(sha256(await d.path())).toBe(sha256(fx('f12-tiny-360p-5s.mp4')));
});

test('impossible targets are refused before encoding with the minimum size', async ({ page }) => {
  await page.goto('/?size=1MB');
  await ready(page);
  await drop(page, [fx('f11-long-360p30-300s.mp4')]);
  const strip = page.getByTestId('impossible');
  await expect(strip).toContainText('Even at the lowest quality this clip needs about');
  await expect(strip.getByRole('button', { name: 'Trim' })).toBeVisible();
  const [it] = await items(page);
  expect(it!.status).toBe('impossible');
});

test('unsupported inputs get a friendly message', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await drop(page, [fx('f17-not-video.mp4'), fx('f16-audio-only.m4a')]);
  await expect(page.getByTestId('error')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByTestId('error').first()).toContainText('Snugclip handles MP4, MOV, M4V, WebM and MKV');
});

test('cancel mid-encode leaves nothing and the queue moves on', async ({ page }) => {
  await page.goto('/?size=3MB');
  await ready(page);
  await drop(page, [fx('f14-perf-1080p30-60s.mp4'), fx('f07-portrait-720x1280-5s.mp4')]);
  await expect(page.locator('[data-state="encoding"], [data-state="analysing"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Cancel f14/ }).click();
  await expect(page.locator('[data-state="cancelled"]')).toBeVisible({ timeout: 5_000 });
  await expect.poll(async () => (await items(page)).find((i) => i.name.startsWith('f07'))?.status, { timeout: 60_000 }).toBe('ready');
});

test('deep links preselect the target and options', async ({ page }) => {
  await page.goto('/?preset=discord&codec=h264&maxh=720&mute=1');
  await ready(page);
  await expect(page.getByRole('radio', { name: /^Discord/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('muted · up to 720p').first()).toBeVisible();
  await page.goto('/?maxh=abc&preset=whatsapp');
  await expect(page.getByRole('radio', { name: /^WhatsApp/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status').getByText(/ignored/)).toBeVisible();
});

test('setup export and import round-trip', async ({ page }) => {
  await page.goto('/?size=12MB&mute=1&maxh=480');
  await ready(page);
  await page.getByRole('button', { name: 'Options' }).first().click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export setup/ }).click();
  const path = await (await dl).path();
  await page.goto('/');
  await ready(page);
  await page.setInputFiles('[data-testid="file-input"]', { name: 'setup.snugclip.json', mimeType: 'application/json', buffer: readFileSync(path) });
  await expect(page.getByTestId('must-fit')).toHaveText('Must fit under 12 MB');
  await expect(page.getByText('muted · up to 480p').first()).toBeVisible();
});

test('pause holds progress; resume finishes under the target', async ({ page }) => {
  await page.goto('/?size=5MB&mute=1');
  await ready(page);
  await drop(page, [fx('f14-perf-1080p30-60s.mp4')]);
  const pause = page.getByRole('button', { name: /^Pause f14/ });
  await expect(pause).toBeVisible({ timeout: 60_000 });
  await pause.click();
  await expect(page.locator('[data-state="paused"]')).toBeVisible();
  const read = () => page.locator('[role="progressbar"]').getAttribute('aria-valuenow');
  const a = await read();
  await page.waitForTimeout(3000);
  expect(await read()).toBe(a);
  await page.getByRole('button', { name: /^Resume f14/ }).click();
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 200_000 });
  const [it] = await items(page);
  expect(it!.report!.output.bytes).toBeLessThanOrEqual(5_000_000);
});

test('batch of 5 all fit and "Download all" zips them', async ({ page }) => {
  await page.goto('/?size=2MB');
  await ready(page);
  const files = ['f01-testsrc2-1080p30-10s.mp4', 'f03-screen-1080p30-30s.mp4', 'f07-portrait-720x1280-5s.mp4', 'f09-vp9-720p30-10s.webm', 'f10-noaudio-720p30-10s.mp4'];
  await drop(page, files.map(fx));
  await expect.poll(async () => (await items(page)).filter((i) => i.status === 'ready').length, { timeout: 200_000 }).toBe(5);
  const all = await items(page);
  for (const i of all) expect(i.report!.output.bytes, i.name).toBeLessThanOrEqual(2_000_000);
  const dl = page.waitForEvent('download');
  await page.getByTestId('download-all').click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe('snugclip-2MB.zip');
  const zip = readFileSync(await d.path());
  // Count local file headers (PK\x03\x04).
  let n = 0;
  for (let i = zip.indexOf('PK\x03\x04'); i !== -1; i = zip.indexOf('PK\x03\x04', i + 4)) n++;
  expect(n).toBe(5);
});

test('trim a refused clip until it fits, then it compresses', async ({ page }) => {
  await page.goto('/?size=1MB&mute=1');
  await ready(page);
  await drop(page, [fx('f11-long-360p30-300s.mp4')]);
  const strip = page.getByTestId('impossible');
  await strip.getByRole('button', { name: 'Trim' }).click();
  const end = page.getByRole('slider', { name: 'Trim end' });
  await end.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowLeft'); // 300 s → 280 s … step 1 s
  await page.keyboard.press('Home'); // end → start + 0.5 s
  for (let i = 0; i < 60; i++) await page.keyboard.press('Shift+ArrowRight'); // ≈ 60 s long
  await expect(page.getByText('Now it fits')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 120_000 });
  const [it] = await items(page);
  expect(it!.report!.output.bytes).toBeLessThanOrEqual(2_000_000);
  expect(it!.report!.output.durationSec).toBeGreaterThan(55);
  expect(it!.report!.output.durationSec).toBeLessThan(65);
});

test('tight budget with sound (AAC below 48 kbps) still fits', async ({ page }) => {
  await page.goto('/?size=450KB');
  await ready(page);
  await drop(page, [fx('f01-testsrc2-1080p30-10s.mp4')]);
  await expect.poll(async () => (await items(page))[0]?.status, { timeout: 120_000 }).toMatch(/ready|error/);
  const [it] = await items(page);
  expect(it!.report?.error?.message ?? '').toBe('');
  expect(it!.report!.output.bytes).toBeLessThanOrEqual(450_000);
});

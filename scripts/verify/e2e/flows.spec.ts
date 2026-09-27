// Verifier: app flows through the real UI on the production static build (Chrome).
// ACCEPTANCE B2, B3, G3, G5, H2, H4, J2, P2 + "no AudioEncoder on page load".
import { expect, test, type Page, type Worker } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chrome flows (other engines: cross-browser.spec.ts)');

const require = createRequire(import.meta.url);
const FIX = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));
const fx = (n: string) => FIX + n;
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const ready = (page: Page) => page.waitForSelector('#tool[data-support="ok"]', { timeout: 30_000 });
const drop = (page: Page, files: string[]) => page.setInputFiles('[data-testid="file-input"]', files);
const items = (page: Page) =>
  page.evaluate(() => (window as any).__snugclip.state().items.map((i: any) => ({ id: i.id, name: i.name, status: i.status, report: i.report, trim: i.trim })));
const state = (page: Page) => page.evaluate(() => { const s = (window as any).__snugclip.state(); return { target: s.target, options: s.options, defaultTrim: s.defaultTrim }; });
function ffprobeDur(p: string) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

// Counts native encoders created in the page (main thread) from the first script on.
async function countMainThreadEncoders(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__enc = { audio: 0, video: 0 };
    for (const [k, n] of [['AudioEncoder', 'audio'], ['VideoEncoder', 'video']] as const) {
      const N = w[k];
      if (!N) continue;
      w[k] = class extends N { constructor(i: any) { super(i); w.__enc[n]++; } };
      w[k].isConfigSupported = N.isConfigSupported.bind(N);
    }
  });
}
// Tracks VideoEncoders created inside workers (wrapped as soon as each worker appears).
async function trackWorkerEncoders(w: Worker) {
  await w.evaluate(() => {
    const g = self as any;
    if (g.__venc) return;
    g.__venc = [];
    const N = g.VideoEncoder;
    if (!N) return;
    g.VideoEncoder = class extends N { constructor(i: any) { super(i); g.__venc.push(this); } };
    g.VideoEncoder.isConfigSupported = N.isConfigSupported.bind(N);
  }).catch(() => {});
}
const openWorkerEncoders = async (page: Page) => {
  let open = 0, made = 0;
  for (const w of page.workers()) {
    const r = await w.evaluate(() => { const l = (self as any).__venc ?? []; return { made: l.length, open: l.filter((e: any) => e.state !== 'closed').length }; }).catch(() => ({ made: 0, open: 0 }));
    open += r.open; made += r.made;
  }
  return { open, made };
};

test('no AudioEncoder (or VideoEncoder) is created on page load', async ({ page }) => {
  await countMainThreadEncoders(page);
  for (const p of ['/', '/compress-video-for-discord/']) {
    await page.goto(p);
    await ready(page);
    await page.waitForTimeout(2000);
    const enc = await page.evaluate(() => (window as any).__enc);
    console.log(`${p}: main-thread encoders on load ${JSON.stringify(enc)}, workers ${page.workers().length}`);
    expect(enc).toEqual({ audio: 0, video: 0 });
  }
});

test('B2/H4: F01 at discord-nitro and F12 at 10 MB come back byte-identical, "Untouched original", no quality badge', async ({ page }) => {
  for (const [q, f] of [['/?preset=discord-nitro', 'f01-testsrc2-1080p30-10s.mp4'], ['/?size=10MB', 'f12-tiny-360p-5s.mp4']] as const) {
    await page.goto(q);
    await ready(page);
    await drop(page, [fx(f)]);
    await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Untouched original').first()).toBeVisible();
    await expect(page.locator('[data-testid="quality"][data-verdict]')).toHaveCount(0); // the "Untouched original" note reuses the testid but carries no verdict
    const dl = page.waitForEvent('download');
    await page.getByTestId('download').click();
    const path = await (await dl).path();
    expect(sha(path), f).toBe(sha(fx(f)));
    console.log(`B2 ${f} ${q}: passthrough sha256 identical (${statSync(path).size} bytes)`);
  }
});

test('B3/G5: deep link with trim start=2&end=7.5 at 1 MB → 5.5 s ± 1 frame, ≤ target', async ({ page }) => {
  await page.goto('/?size=1MB&start=2&end=7.5');
  await ready(page);
  await drop(page, [fx('f01-testsrc2-1080p30-10s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 120_000 });
  const [it] = await items(page);
  expect(it.report.status).toBe('fit');
  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  const path = await (await dl).path();
  const bytes = statSync(path).size;
  const d = ffprobeDur(path);
  const fps = it.report.output.video.fps;
  console.log(`B3 trim: ${bytes} bytes, ffprobe duration ${d} s (want 5.5 ± ${(1 / fps).toFixed(3)}), ${it.report.output.video.width}x${it.report.output.video.height}@${fps}`);
  expect(bytes).toBeLessThanOrEqual(1_000_000);
  expect(Math.abs(d - 5.5)).toBeLessThanOrEqual(1 / fps + 0.03);
});

test('G5: /?preset=discord&codec=h264&maxh=720&mute=1&start=1&end=3 preselects everything; maxh=abc ignored with a notice', async ({ page }) => {
  await page.goto('/?preset=discord&codec=h264&maxh=720&mute=1&start=1&end=3');
  await ready(page);
  await expect(page.getByRole('radio', { name: /^Discord/ })).toHaveAttribute('aria-checked', 'true');
  const s = await state(page);
  console.log('G5 state', JSON.stringify(s));
  expect(s.target.bytes).toBe(20_000_000);
  expect(s.options.codec).toMatch(/h264|compatible/);
  expect(s.options.maxShortSide).toBe(720);
  expect(s.options.mute).toBe(true);
  expect(s.defaultTrim).toEqual({ startSec: 1, endSec: 3 });
  await drop(page, [fx('f07-portrait-720x1280-5s.mp4')]);
  await expect.poll(async () => (await items(page))[0]?.trim).toEqual({ startSec: 1, endSec: 3 });
  await page.goto('/?maxh=abc&preset=whatsapp');
  await ready(page);
  await expect(page.getByRole('status').getByText(/ignored/)).toBeVisible();
  expect((await state(page)).options.maxShortSide).toBeUndefined();
});

test('G3: export setup → reload → import restores identical settings; "Export report" validates against /schema/job.v1.json with reports[0].fits', async ({ page, request }) => {
  await page.goto('/?size=12MB&mute=1&maxh=480&codec=h264');
  await ready(page);
  const before = await state(page);
  await page.getByRole('button', { name: 'Options' }).first().click();
  let dl = page.waitForEvent('download');
  const exportBtn = page.getByRole('button', { name: /Export setup|Save settings file/ });
  if (!(await exportBtn.isVisible())) await page.getByText('Share or reuse these settings').click();
  await exportBtn.click();
  const setupPath = await (await dl).path();
  await page.goto('/');
  await ready(page);
  await page.setInputFiles('[data-testid="file-input"]', { name: 'setup.snugclip.json', mimeType: 'application/json', buffer: readFileSync(setupPath) });
  await expect(page.getByTestId('must-fit')).toHaveAttribute('aria-label', 'Must fit under 12 MB');
  const after = await state(page);
  expect(after.target.bytes).toBe(before.target.bytes);
  expect(after.options).toEqual(before.options);

  await drop(page, [fx('f10-noaudio-720p30-10s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 90_000 });
  dl = page.waitForEvent('download');
  // Since 7c43f40 the report export lives in the review card's Details popover.
  const exp = page.getByRole('button', { name: /^(Export report|Save report.*)$/ }).first();
  if (!(await exp.isVisible())) await page.getByRole('button', { name: 'Details' }).first().click();
  await exp.click();
  const report = JSON.parse(readFileSync(await (await dl).path(), 'utf8'));
  const schema = await (await request.get('/schema/job.v1.json')).json();
  const Ajv = require(require.resolve('ajv/dist/2020', { paths: [require.resolve('../../../packages/mcp/package.json')] }));
  const ajv = new (Ajv.default ?? Ajv)({ strict: false });
  const addFormats = (() => { try { return require(require.resolve('ajv-formats', { paths: [require.resolve('../../../packages/mcp/package.json')] })); } catch { return null; } })();
  if (addFormats) (addFormats.default ?? addFormats)(ajv);
  const validate = ajv.compile(schema);
  const ok = validate(report);
  console.log(`G3 report: valid=${ok} reports=${report.reports?.length} fits=${report.reports?.[0]?.fits} ${ok ? '' : JSON.stringify(validate.errors).slice(0, 500)}`);
  expect(ok).toBe(true);
  expect(report.reports[0].fits).toBe(true);
});

test('H2: cancel item 2 mid-encode → cancelled within 2 s, queue proceeds, 0 open VideoEncoders, no download for it', async ({ page }) => {
  page.on('worker', (w) => void trackWorkerEncoders(w));
  await page.goto('/?size=3MB');
  await ready(page);
  const baseWorkers = page.workers().length;
  for (const w of page.workers()) await trackWorkerEncoders(w);
  await drop(page, [fx('f07-portrait-720x1280-5s.mp4'), fx('f14-perf-1080p30-60s.mp4'), fx('f10-noaudio-720p30-10s.mp4')]);
  const cancelBtn = page.getByRole('button', { name: /^Cancel f14/ });
  await expect.poll(async () => (await items(page)).find((i: any) => i.name.startsWith('f14'))?.status, { timeout: 90_000 }).toMatch(/encoding|analysing|calibrating|running/);
  await page.waitForTimeout(3000);
  const t = Date.now();
  await cancelBtn.click();
  await expect.poll(async () => (await items(page)).find((i: any) => i.name.startsWith('f14'))?.status, { timeout: 5000, intervals: [100] }).toBe('cancelled');
  const cancelMs = Date.now() - t;
  await expect.poll(async () => (await items(page)).filter((i: any) => i.status === 'ready').length, { timeout: 120_000 }).toBe(2);
  await page.waitForTimeout(1500);
  const enc = await openWorkerEncoders(page);
  const workers = page.workers().length;
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByTestId('download-all').click();
  await page.waitForTimeout(3000);
  console.log(`H2: cancelled in ${cancelMs} ms; workers ${baseWorkers}→${workers}; VideoEncoders made ${enc.made}, open ${enc.open}; downloads ${JSON.stringify(downloads)}`);
  expect(cancelMs).toBeLessThanOrEqual(2000);
  expect(enc.open).toBe(0);
  expect(Math.abs(workers - baseWorkers)).toBeLessThanOrEqual(1);
  expect(downloads.some((d) => d.startsWith('f14'))).toBe(false);
});

test('P2: support card once per session after first download; "Don\'t show again" persists in a new context; never a dialog', async ({ page, browser }) => {
  await page.goto('/?size=1MB');
  await ready(page);
  await drop(page, [fx('f10-noaudio-720p30-10s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('support-card')).toHaveCount(0);
  let dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  await dl;
  const card = page.getByTestId('support-card');
  await expect(card).toBeVisible();
  await expect(page.locator('[role="dialog"], dialog[open]')).toHaveCount(0);
  await card.getByRole('button', { name: "Don't show again" }).click();
  await expect(card).toHaveCount(0);
  dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  await dl;
  await page.waitForTimeout(500);
  await expect(page.getByTestId('support-card')).toHaveCount(0);
  const storage = await page.context().storageState();
  const ctx2 = await browser.newContext({ storageState: storage, acceptDownloads: true, baseURL: 'http://127.0.0.1:4319' });
  const p2 = await ctx2.newPage();
  await p2.goto('/?size=10MB');
  await ready(p2);
  await drop(p2, [fx('f12-tiny-360p-5s.mp4')]);
  await expect(p2.locator('[data-state="review"]')).toBeVisible({ timeout: 30_000 });
  const dl2 = p2.waitForEvent('download');
  await p2.getByTestId('download').click();
  await dl2;
  await p2.waitForTimeout(800);
  await expect(p2.getByTestId('support-card')).toHaveCount(0);
  await ctx2.close();

  // Same session, "Not now" → a second successful download doesn't show it again.
  const ctx3 = await browser.newContext({ acceptDownloads: true, baseURL: 'http://127.0.0.1:4319' });
  const p3 = await ctx3.newPage();
  await p3.goto('/?size=10MB');
  await ready(p3);
  await drop(p3, [fx('f12-tiny-360p-5s.mp4')]);
  await expect(p3.locator('[data-state="review"]')).toBeVisible({ timeout: 30_000 });
  let d3 = p3.waitForEvent('download');
  await p3.getByTestId('download').click();
  await d3;
  await expect(p3.getByTestId('support-card')).toBeVisible();
  await p3.getByTestId('support-card').getByRole('button', { name: 'Not now' }).click();
  await p3.goto('/?size=10MB');
  await ready(p3);
  await drop(p3, [fx('f12-tiny-360p-5s.mp4')]);
  await expect(p3.locator('[data-state="review"]')).toBeVisible({ timeout: 30_000 });
  d3 = p3.waitForEvent('download');
  await p3.getByTestId('download').click();
  await d3;
  await p3.waitForTimeout(800);
  await expect(p3.getByTestId('support-card')).toHaveCount(0);
  await ctx3.close();
});

test('J2: zero third-party requests across load, drop, compress, preview, download, support, about, keyword page, job import', async ({ page }) => {
  const foreign: string[] = [];
  const all: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    all.push(u.origin);
    if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== 'http://127.0.0.1:4319') foreign.push(r.url());
  });
  await page.goto('/?size=2MB');
  await ready(page);
  await drop(page, [fx('f01-testsrc2-1080p30-10s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('compare')).toBeVisible();
  const slider = page.getByRole('slider', { name: /./ }).first();
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  await dl;
  for (const p of ['/support/', '/about/', '/compress-video-for-discord/', '/llms.txt', '/']) await page.goto(p);
  await ready(page);
  await page.setInputFiles('[data-testid="file-input"]', {
    name: 'j.snugclip.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ snugclip: 'job', version: 1, target: { preset: 'gmail' }, options: { mute: true } })),
  });
  await expect(page.getByTestId('must-fit')).toHaveAttribute('aria-label', 'Must fit under 18 MB');
  console.log(`J2: ${all.length} requests, origins ${JSON.stringify([...new Set(all)])}, foreign ${foreign.length}`);
  expect(foreign).toEqual([]);
});

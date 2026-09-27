// Verifier: ACCEPTANCE I1/I3/J1 per engine. Runs in every project (chrome, firefox, webkit):
// either the tool fits the clips, or the browser gets the friendly unsupported message. Records which.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIX = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));
const fx = (n: string) => FIX + n;
const drop = (page: Page, files: string[]) => page.setInputFiles('[data-testid="file-input"]', files);
const items = (page: Page) => page.evaluate(() => (window as any).__snugclip.state().items.map((i: any) => ({ name: i.name, status: i.status, report: i.report, error: i.error })));

async function support(page: Page) {
  await page.waitForSelector('#tool[data-support="ok"], #tool[data-support="unsupported"]', { timeout: 30_000 });
  return page.locator('#tool').getAttribute('data-support');
}
async function seriousAxe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message ?? '').slice(0, 160)}`).join(' | ')}`);
}

test('I1/I3: compress F01 @2MB and F10 @1MB, or show the friendly unsupported message', async ({ page, browserName }) => {
  const vendor: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/vendor/aac-encoder')) vendor.push(new URL(r.url()).origin); });
  await page.goto('/?size=2MB');
  const s = await support(page);
  const info = await page.evaluate(() => ({ ua: navigator.userAgent, ve: typeof (window as any).VideoEncoder, ae: typeof (window as any).AudioEncoder, engine: (window as any).__snugclip?.engine, reason: (window as any).__snugclip?.reason }));
  console.log(`[${browserName}] support=${s} ${JSON.stringify(info)}`);
  if (s === 'unsupported') {
    await expect(page.getByTestId('unsupported')).toBeVisible();
    const txt = await page.getByTestId('unsupported').innerText();
    console.log(`[${browserName}] friendly message: ${txt.replace(/\s+/g, ' ').slice(0, 200)}`);
    expect(await seriousAxe(page)).toEqual([]);
    return;
  }
  const results: string[] = [];
  for (const [q, f, limit] of [['/?size=2MB', 'f01-testsrc2-1080p30-10s.mp4', 2_000_000], ['/?size=1MB', 'f10-noaudio-720p30-10s.mp4', 1_000_000], ['/?size=2MB&start=1&end=6', 'f01-testsrc2-1080p30-10s.mp4', 2_000_000]] as const) {
    await page.goto(q);
    await support(page);
    await drop(page, [fx(f)]);
    await expect.poll(async () => (await items(page))[0]?.status, { timeout: 240_000 }).toMatch(/ready|error|impossible/);
    const [it] = await items(page);
    const r = it.report;
    const line = `${q} ${f}: ${it.status} ${r?.output?.bytes ?? ''}/${limit} ${r?.output ? `${r.output.container} ${r.output.video?.codec} ${r.output.video?.width}x${r.output.video?.height} audio ${r.output.audio?.codec ?? 'none'}` : ''} encoder=${r?.engine?.encoder ?? ''} err=${JSON.stringify(it.error ?? r?.error ?? '')} warnings=${JSON.stringify((r?.warnings ?? []).map((w: any) => w.code))}`;
    results.push(line);
    console.log(`[${browserName}] ${line}`);
    expect(it.status, line).toBe('ready');
    expect(r.output.bytes).toBeLessThanOrEqual(limit);
  }
  console.log(`[${browserName}] AAC vendor requests from: ${JSON.stringify([...new Set(vendor)])}`);
  for (const o of vendor) expect(o).toBe(new URL(page.url()).origin);
});

test('I3: F15 (MPEG-2) and F16 (audio only) get the per-file message listing supported formats', async ({ page, browserName }) => {
  await page.goto('/');
  const s = await support(page);
  test.skip(s !== 'ok', `${browserName}: whole browser unsupported (covered above)`);
  await drop(page, [fx('f15-mpeg2-240p-2s.mpg'), fx('f16-audio-only.m4a')]);
  await expect(page.getByTestId('error')).toHaveCount(2, { timeout: 30_000 });
  const t = await page.getByTestId('error').allInnerTexts();
  console.log(`[${browserName}] per-file messages: ${t.map((x) => x.replace(/\s+/g, ' ').slice(0, 140)).join(' || ')}`);
  for (const x of t) expect(x).toContain('MP4, MOV, M4V, WebM and MKV');
  expect(await seriousAxe(page)).toEqual([]);
});

test('I3: a browser without VideoEncoder gets the friendly message (init script)', async ({ page, browserName }) => {
  await page.addInitScript(() => { delete (window as any).VideoEncoder; });
  await page.goto('/');
  await expect(page.getByTestId('unsupported')).toBeVisible({ timeout: 30_000 });
  console.log(`[${browserName}] no-VideoEncoder message: ${(await page.getByTestId('unsupported').innerText()).replace(/\s+/g, ' ').slice(0, 160)}`);
  expect(await seriousAxe(page)).toEqual([]);
});

test('J1: offline after first load — reload / and a keyword page, compress F10 @1MB and F01 trimmed (AAC re-encode) offline', async ({ page, context, browserName }) => {
  await page.goto('/');
  const s = await support(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await expect.poll(() => page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; }), { timeout: 90_000 }).toBeGreaterThan(100);
  await context.setOffline(true);
  try {
    await page.goto('/compress-video-for-discord/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compress video for Discord');
    await page.goto('/');
    await expect(page.locator('#tool')).toBeVisible();
    if (s !== 'ok') {
      console.log(`[${browserName}] offline pages render; encode skipped (browser unsupported)`);
      return;
    }
    for (const [q, f, limit] of [['/?size=1MB', 'f10-noaudio-720p30-10s.mp4', 1_000_000], ['/?size=2MB&start=1&end=6', 'f01-testsrc2-1080p30-10s.mp4', 2_000_000]] as const) {
      await page.goto(q);
      await support(page);
      await drop(page, [fx(f)]);
      await expect.poll(async () => (await items(page))[0]?.status, { timeout: 240_000 }).toMatch(/ready|error/);
      const [it] = await items(page);
      console.log(`[${browserName}] offline ${q} ${f}: ${it.status} ${it.report?.output?.bytes ?? ''} audio=${it.report?.output?.audio?.codec ?? 'none'} encoder=${it.report?.engine?.encoder ?? ''} ${JSON.stringify(it.error ?? '')}`);
      expect(it.status).toBe('ready');
      expect(it.report.output.bytes).toBeLessThanOrEqual(limit);
    }
  } finally {
    await context.setOffline(false);
  }
});

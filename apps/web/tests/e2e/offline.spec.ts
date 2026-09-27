import { expect, test } from '@playwright/test';
import { drop, fx, items, ready } from './helpers';

test('no requests leave our origin across the whole flow', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['blob:', 'data:'].includes(u.protocol) && u.origin !== 'http://127.0.0.1:4317') foreign.push(r.url());
  });
  await page.goto('/?size=2MB');
  await ready(page);
  await drop(page, [fx('f10-noaudio-720p30-10s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 90_000 });
  const dl = page.waitForEvent('download');
  await page.getByTestId('download').click();
  await dl;
  for (const p of ['/support/', '/about/', '/compress-video-for-discord/', '/llms.txt']) await page.goto(p);
  expect(foreign).toEqual([]);
});

test('works offline after the first visit (service worker precache)', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    return reg.active?.state;
  });
  // Let the precache finish.
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          let n = 0;
          for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length;
          return n;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(100);
  await context.setOffline(true);
  await page.goto('/compress-video-for-discord/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compress video for Discord');
  await expect(page.locator('#tool[data-support="ok"]')).toBeVisible({ timeout: 30_000 });
  await page.goto('/?size=1MB');
  await ready(page);
  await drop(page, [fx('f10-noaudio-720p30-10s.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 90_000 });
  const [it] = await items(page);
  expect(it!.report!.output.bytes).toBeLessThanOrEqual(1_000_000);
  expect(await page.evaluate(async () => !!(await caches.match('/vendor/aac-encoder-1.60.0.mjs', { ignoreSearch: true })))).toBe(true);
  await context.setOffline(false);
});

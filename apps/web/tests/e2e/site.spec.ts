import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DONATION_LINKS, SITE_URL } from '../../src/config/site';
import { drop, fx, ready } from './helpers';

const PAGES = ['/', '/compress-video-for-discord/', '/compress-video-for-whatsapp/', '/compress-video-for-email/', '/compress-video-to-10mb/', '/support/', '/about/'];

async function axe(page: import('@playwright/test').Page, label: string) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no serious violations on every page (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    for (const p of PAGES) {
      await page.goto(p);
      await page.waitForLoadState('load');
      await axe(page, `${p} ${scheme}`);
    }
  });
}

test('axe: queue states (queued, running, ready, impossible, error, options open)', async ({ page }) => {
  await page.goto('/?size=2MB');
  await ready(page);
  await drop(page, [fx('f01-testsrc2-1080p30-10s.mp4'), fx('f03-screen-1080p30-30s.mp4'), fx('f11-long-360p30-300s.mp4'), fx('f17-not-video.mp4')]);
  await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 120_000 });
  await axe(page, 'queue');
  await page.getByRole('button', { name: 'Options' }).first().click();
  await page.waitForTimeout(500);
  await axe(page, 'options');
});

test('support page renders the shared Stripe links; one-time first', async ({ page }) => {
  await page.goto('/support/');
  const hrefs = [DONATION_LINKS.once, ...DONATION_LINKS.monthly.map((m) => m.href)];
  // Every payment link on the page, in order, is exactly DONATION_LINKS (one-time first, then the 4 tiers).
  const found = await page.locator('main a').evaluateAll((as, hs) => as.map((a) => a.getAttribute('href')).filter((h) => hs.includes(h ?? '')), hrefs);
  expect(found).toEqual(hrefs);
  for (const p of ['/', '/about/']) {
    await page.goto(p);
    await expect(page.locator('header a[href="/support/"]')).toHaveCount(1);
    await expect(page.locator('footer a[href="/support/"]')).toHaveCount(1);
  }
});

test('keyword pages are static, unique and preselect their preset', async ({ page, request }) => {
  const titles = new Set<string>();
  for (const slug of ['compress-video-for-discord', 'compress-video-to-8mb', 'compress-video-for-whatsapp', 'compress-video-for-email', 'compress-mov']) {
    const html = await (await request.get(`/${slug}/`)).text();
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/${slug}/"/>`);
    expect(html.match(/<h1[ >]/g)?.length).toBe(1);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('aria-checked="true"');
    const title = /<title>([^<]+)<\/title>/.exec(html)![1]!;
    expect(titles.has(title)).toBe(false);
    titles.add(title);
  }
  await page.goto('/compress-video-for-whatsapp/');
  await expect(page.getByRole('radio', { name: /^WhatsApp/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('must-fit')).toHaveText('Fits under 64 MB');
});

test('sitemap, robots, llms.txt and the job schema exist', async ({ request }) => {
  const sm = await (await request.get('/sitemap.xml')).text();
  expect(sm.match(/<loc>/g)?.length).toBe(15);
  expect(await (await request.get('/robots.txt')).text()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  const llms = await (await request.get('/llms.txt')).text();
  for (const s of ['snugclip compress', 'compress_video', 'plan_compression', 'probe_video', 'list_presets', 'job.v1.json', 'Exit codes']) expect(llms).toContain(s);
  const schema = await (await request.get('/schema/job.v1.json')).json();
  expect(schema.$id).toBe(`${SITE_URL}/schema/job.v1.json`);
});

test('browsers without WebCodecs get the friendly message', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulate an unsupported browser
    delete window.VideoEncoder;
  });
  await page.goto('/');
  await expect(page.getByTestId('unsupported')).toBeVisible();
  await expect(page.getByText('Chrome, Edge or Brave')).toBeVisible();
  await axe(page, 'unsupported');
});

test('theme toggle overrides the OS and persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/about/');
  await page.getByRole('button', { name: 'Theme: follow system' }).click();
  await page.getByRole('button', { name: 'Theme: light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

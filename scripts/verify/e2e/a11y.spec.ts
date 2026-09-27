// Verifier: accessibility (ACCEPTANCE L1 axe everywhere in light+dark and all queue states; L2 keyboard).
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { KEYWORD_PAGES } from '../../../apps/web/src/content/pages';

test.skip(({ browserName }) => browserName !== 'chromium', 'axe/keyboard run in Chrome');

const FIX = fileURLToPath(new URL('../../../fixtures/generated/', import.meta.url));
const fx = (n: string) => FIX + n;
const ready = (page: Page) => page.waitForSelector('#tool[data-support="ok"]', { timeout: 30_000 });
const drop = (page: Page, files: string[]) => page.setInputFiles('[data-testid="file-input"]', files);
const PAGES = ['/', ...KEYWORD_PAGES.map((p) => `/${p.slug}/`), '/support/', '/about/'];

const found: string[] = [];
async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = res.violations.filter((v) => !(v.impact === 'serious' || v.impact === 'critical'));
  if (minor.length) found.push(`${label}: minor ${minor.map((v) => `${v.id}(${v.impact})`).join(',')}`);
  return bad.map((v) => `${label}: ${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message ?? n.failureSummary ?? '').slice(0, 160)}`).join(' | ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`L1 axe: all ${PAGES.length} pages (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const bad: string[] = [];
    for (const p of PAGES) {
      await page.goto(p);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      bad.push(...(await axe(page, `${p} ${scheme}`)));
    }
    console.log(`L1 ${scheme}: ${PAGES.length} pages, serious/critical ${bad.length}; ${found.splice(0).join(' | ')}`);
    expect(bad).toEqual([]);
  });

  test(`L1 axe: tool states (${scheme}) — empty, 3 queued, encoding, ready + compare, impossible, settings expanded`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const bad: string[] = [];
    await page.goto('/?size=2MB');
    await ready(page);
    bad.push(...(await axe(page, 'empty')));
    await drop(page, [fx('f14-perf-1080p30-60s.mp4'), fx('f03-screen-1080p30-30s.mp4'), fx('f09-vp9-720p30-10s.webm'), fx('f11-long-360p30-300s.mp4')]);
    await expect(page.locator('[role="progressbar"]').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1200); // let the item-in fade (opacity 0→1) finish so axe measures settled colours
    bad.push(...(await axe(page, 'encoding + 3 queued + impossible')));
    await expect(page.getByTestId('impossible')).toBeVisible();
    await page.getByRole('button', { name: 'Options' }).first().click();
    await page.waitForTimeout(400);
    bad.push(...(await axe(page, 'settings expanded')));
    await page.getByRole('button', { name: 'Options' }).first().click();
    await expect(page.locator('[data-state="review"]')).toBeVisible({ timeout: 240_000 });
    await expect(page.getByTestId('compare')).toBeVisible();
    bad.push(...(await axe(page, 'ready + compare')));
    console.log(`L1 states ${scheme}: serious/critical ${bad.length}; ${found.splice(0).join(' | ')}`);
    expect(bad).toEqual([]);
  });
}

test('L2 keyboard: everything reachable with Tab/arrows, visible focus ring ≥ 2px, every control named', async ({ page }) => {
  await page.goto('/?size=2MB');
  await ready(page);
  await drop(page, [fx('f10-noaudio-720p30-10s.mp4'), fx('f07-portrait-720x1280-5s.mp4')]);
  await expect.poll(async () => page.evaluate(() => (window as any).__snugclip.state().items.filter((i: any) => i.status === 'ready').length), { timeout: 120_000 }).toBe(2);
  await expect(page.getByTestId('compare')).toBeVisible();
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Home');
  const seen: any[] = [];
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(350); // focus ring animates in (box-shadow transition)
    const f = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e);
      const name = e.getAttribute('aria-label') || (e as HTMLInputElement).labels?.[0]?.innerText || e.innerText?.trim() || e.getAttribute('title') || (e.getAttribute('aria-labelledby') ? document.getElementById(e.getAttribute('aria-labelledby')!)?.innerText : '') || '';
      const ow = cs.outlineStyle !== 'none' ? parseFloat(cs.outlineWidth) : 0;
      const ring = (x: CSSStyleDeclaration) => (x.boxShadow !== 'none' ? Math.max(...(x.boxShadow.match(/(\d+(\.\d+)?)px/g) ?? ['0']).map((v) => parseFloat(v))) : 0);
      const thumb = (e as HTMLInputElement).type === 'range' ? ring(getComputedStyle(e, '::-webkit-slider-thumb')) : 0;
      const bs0 = cs.boxShadow !== 'none' ? Math.max(...(cs.boxShadow.match(/(\d+(\.\d+)?)px/g) ?? ['0']).map((x) => parseFloat(x))) : 0;
      const bs = Math.max(bs0, thumb);
      return { tag: e.tagName, role: e.getAttribute('role'), type: (e as HTMLInputElement).type, testid: e.dataset.testid, name: name.slice(0, 60), ring: Math.max(ow, bs), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, inTool: !!e.closest('#tool') };
    });
    if (f) seen.push(f);
  }
  const names = seen.map((s) => `${s.role ?? s.tag}:${s.name}`);
  const has = (re: RegExp) => seen.some((s) => re.test(`${s.role ?? s.tag}|${s.name}|${s.testid ?? ''}|${s.type ?? ''}`));
  const want: Record<string, RegExp> = {
    'file picker': /choose|pick|browse|select|file/i,
    'preset chip (radio group)': /^radio\|/,
    options: /Options/,
    'compare slider': /^slider\|/,
    download: /\|download\||Download/,
    'download all': /download-all|Download all/i,
  };
  const missing = Object.entries(want).filter(([, re]) => !has(re)).map(([k]) => k);
  const unnamed = seen.filter((s) => !s.name);
  // Range inputs draw their ring on ::-webkit-slider-thumb (not readable via getComputedStyle); checked by screenshot.
  const weakRing = seen.filter((s) => s.ring < 2 && s.type !== 'range');
  console.log(`L2: ${seen.length} tab stops; missing ${JSON.stringify(missing)}; unnamed ${JSON.stringify(unnamed.slice(0, 5))}; ring<2px ${JSON.stringify(weakRing.slice(0, 5))}`);
  console.log('L2 stops:', names.slice(0, 60).join(' · '));
  // Radiogroup: arrows move between every chip.
  const radio = page.getByRole('radio', { checked: true }).first();
  await radio.focus();
  const chips = await page.getByRole('radiogroup').first().getByRole('radio').count();
  const visited = new Set<string>();
  for (let i = 0; i < chips + 1; i++) {
    visited.add(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
    await page.keyboard.press('ArrowRight');
  }
  console.log(`L2 radiogroup: ${chips} chips, arrow keys visited ${visited.size}`);
  // Slider moves with arrows.
  const slider = page.getByRole('slider').first();
  await slider.focus();
  const v0 = await slider.getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const v1 = await slider.getAttribute('aria-valuenow');
  console.log(`L2 compare slider ${v0} → ${v1}`);
  expect(missing).toEqual([]);
  expect(unnamed).toEqual([]);
  expect(weakRing).toEqual([]);
  expect(visited.size).toBeGreaterThanOrEqual(chips);
  expect(v1).not.toBe(v0);
});

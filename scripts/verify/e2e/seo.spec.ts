// Verifier: SEO, agent docs, support links and manifest (ACCEPTANCE O1–O6, P1, P4, J3 static part).
// Chrome project only (static HTML checks; the engine doesn't matter).
import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { DONATION_LINKS, SITE_URL } from '../../../apps/web/src/config/site';
import { KEYWORD_PAGES } from '../../../apps/web/src/content/pages';

const require = createRequire(import.meta.url);
test.skip(({ browserName }) => browserName !== 'chromium', 'static checks run once, in Chrome');

type PageInfo = { slug: string; title: string; description: string; canonical: string | null; h1: number; words: number; text: string; faqOk: boolean; pressed: number };

const info: PageInfo[] = [];

test('O1: every keyword page is prerendered with unique title/description, canonical, one h1, ≥400 words, FAQPage JSON-LD, preset preselected', async ({ page, request }) => {
  expect(KEYWORD_PAGES.length).toBe(12);
  for (const kp of KEYWORD_PAGES) {
    const raw = await (await request.get(`/${kp.slug}/`)).text();
    // Prerendered: the canonical, h1 and FAQ are in the raw HTML (no JS needed).
    expect(raw, kp.slug).toContain(`<link rel="canonical" href="${SITE_URL}/${kp.slug}/"/>`);
    expect(raw.match(/<h1[ >]/g)?.length, kp.slug).toBe(1);
    await page.goto(`/${kp.slug}/`);
    const d = await page.evaluate(() => {
      const main = document.querySelector('main')!.cloneNode(true) as HTMLElement;
      main.querySelector('#tool')?.remove();
      const text = (main.innerText || main.textContent || '').replace(/\s+/g, ' ').trim();
      let faqOk = false;
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent!);
          const arr = Array.isArray(j) ? j : j['@graph'] ?? [j];
          if (arr.some((x: any) => x['@type'] === 'FAQPage' && Array.isArray(x.mainEntity) && x.mainEntity.length > 0)) faqOk = true;
        } catch {}
      }
      return {
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
        h1: document.querySelectorAll('h1').length,
        words: text.split(' ').filter((w) => /\w/.test(w)).length,
        text,
        faqOk,
        pressed: document.querySelectorAll('#tool [aria-checked="true"], #tool [aria-pressed="true"]').length,
      };
    });
    info.push({ slug: kp.slug, ...d });
    expect(d.canonical, kp.slug).toBe(`${SITE_URL}/${kp.slug}/`);
    expect(d.h1, kp.slug).toBe(1);
    expect(d.words, `${kp.slug} words outside the tool`).toBeGreaterThanOrEqual(400);
    expect(d.faqOk, `${kp.slug} FAQPage JSON-LD`).toBe(true);
    expect(d.pressed, `${kp.slug} preset preselected`).toBeGreaterThan(0);
  }
  // Uniqueness across keyword pages + home, support, about.
  for (const p of ['/', '/support/', '/about/']) {
    await page.goto(p);
    info.push({ slug: p, title: await page.title(), description: (await page.locator('meta[name="description"]').getAttribute('content')) ?? '', canonical: null, h1: 0, words: 0, text: '', faqOk: false, pressed: 0 });
  }
  const titles = info.map((i) => i.title);
  const descs = info.map((i) => i.description);
  expect(new Set(titles).size, 'unique titles').toBe(titles.length);
  expect(new Set(descs).size, 'unique descriptions').toBe(descs.length);
  expect(descs.every((d) => d.length > 50)).toBe(true);
  console.log('O1 words:', info.filter((i) => i.words).map((i) => `${i.slug}=${i.words}`).join(' '));

  // O2: pairwise 5-word-shingle Jaccard < 0.5.
  const sh = (t: string) => {
    const w = t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const s = new Set<string>();
    for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' '));
    return s;
  };
  const kw = info.filter((i) => i.words);
  const sets = kw.map((i) => sh(i.text));
  let max = { j: 0, a: '', b: '' };
  for (let a = 0; a < sets.length; a++)
    for (let b = a + 1; b < sets.length; b++) {
      let inter = 0;
      for (const x of sets[a]!) if (sets[b]!.has(x)) inter++;
      const j = inter / (sets[a]!.size + sets[b]!.size - inter);
      if (j > max.j) max = { j, a: kw[a]!.slug, b: kw[b]!.slug };
    }
  console.log(`O2 max Jaccard ${max.j.toFixed(3)} (${max.a} vs ${max.b})`);
  expect(max.j).toBeLessThan(0.5);
});

test('O3: sitemap lists every page with SITE_URL; robots references it', async ({ request }) => {
  const sm = await (await request.get('/sitemap.xml')).text();
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const want = ['/', ...KEYWORD_PAGES.map((p) => `/${p.slug}/`), '/support/', '/about/'].map((p) => SITE_URL + p);
  for (const w of want) expect(locs, w).toContain(w);
  expect(locs.every((l) => l.startsWith(SITE_URL + '/'))).toBe(true);
  console.log(`O3 sitemap: ${locs.length} URLs`);
  expect(await (await request.get('/robots.txt')).text()).toContain(`${SITE_URL}/sitemap.xml`);
});

test('O4: llms.txt mentions the CLI, MCP tools, job schema and exit codes; job.v1.json compiles with ajv', async ({ request }) => {
  const r = await request.get('/llms.txt');
  expect(r.status()).toBe(200);
  const llms = await r.text();
  for (const s of ['snugclip compress', 'compress_video', 'plan_compression', 'probe_video', 'list_presets', 'job.v1.json']) expect(llms, s).toContain(s);
  expect(llms).toMatch(/exit code/i);
  const schema = await (await request.get('/schema/job.v1.json')).json();
  const Ajv = require(require.resolve('ajv/dist/2020', { paths: [require.resolve('../../../packages/mcp/package.json')] }));
  const AjvCls = Ajv.default ?? Ajv;
  const ajv = new AjvCls({ strict: false });
  const validate = ajv.compile(schema);
  expect(validate({ snugclip: 'job', version: 1, target: { preset: 'discord' } }), JSON.stringify(validate.errors)).toBe(true);
  console.log(`O4 llms.txt ${llms.length} chars; schema $id ${schema.$id}`);
});

test('O5: preset numbers and checked date on the Discord/WhatsApp/email pages', async ({ page }) => {
  const want: Record<string, string[]> = {
    '/compress-video-for-discord/': ['20 MB'],
    '/compress-video-for-whatsapp/': ['64 MB', '100 MB', '2 GB'],
    '/compress-video-for-email/': ['18 MB', '14.5 MB'],
  };
  for (const [p, nums] of Object.entries(want)) {
    await page.goto(p);
    const text = await page.locator('main').innerText();
    for (const n of nums) expect(text, `${p} ${n}`).toContain(n);
    expect(text, `${p} checked date`).toMatch(/2026-09-27|27 September 2026|September 27, 2026|27 Sep 2026|Sep 27, 2026/);
  }
});

test('P1/P4: support page renders DONATION_LINKS (one-time first); header, footer and about link to /support/', async ({ page }) => {
  await page.goto('/support/');
  const hrefs = await page.locator('main a[href*="stripe"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual([DONATION_LINKS.once, ...DONATION_LINKS.monthly.map((m) => m.href)]);
  for (const p of ['/', '/about/', '/compress-video-for-discord/']) {
    await page.goto(p);
    expect(await page.locator('header a[href="/support/"]').count(), `${p} header`).toBeGreaterThan(0);
    expect(await page.locator('footer a[href="/support/"]').count(), `${p} footer`).toBeGreaterThan(0);
  }
  await page.goto('/about/');
  expect(await page.locator('main a[href="/support/"]').count(), 'about body').toBeGreaterThan(0);
});

test('J3: manifest is valid with 192/512/maskable icons; icons are served', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const href = /<link rel="manifest" href="([^"]+)"/.exec(html)?.[1];
  expect(href).toBeTruthy();
  const m = await (await request.get(href!)).json();
  expect(m.name).toBe('Snugclip');
  expect(m.start_url).toBeTruthy();
  expect(m.display).toBe('standalone');
  const sizes = m.icons.map((i: any) => `${i.sizes}:${i.purpose ?? 'any'}`);
  expect(sizes).toContain('192x192:any');
  expect(sizes).toContain('512x512:any');
  expect(m.icons.some((i: any) => i.purpose?.includes('maskable'))).toBe(true);
  for (const i of m.icons) expect((await request.get(i.src)).status(), i.src).toBe(200);
});

test('J3: Chrome reports the page installable (CDP Page.getInstallabilityErrors)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cdp = await page.context().newCDPSession(page);
  const r = await cdp.send('Page.getInstallabilityErrors' as any);
  console.log(`J3 installability errors: ${JSON.stringify((r as any).installabilityErrors)}`);
  // Playwright contexts are incognito; 'in-incognito' is the environment, not the app.
  expect((r as any).installabilityErrors.filter((e: any) => e.errorId !== 'in-incognito')).toEqual([]);
});

import { describe, expect, it } from 'vitest';
import { KEYWORD_PAGES } from '@/content/pages';
import { planTable } from '@/content/planTable';

const body = (p: (typeof KEYWORD_PAGES)[number]) =>
  [
    p.limits.intro,
    ...p.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : b.kind === 'list' ? b.items : []))),
    ...p.howTo.flatMap((h) => [h.title, h.body]),
    ...p.faq.flatMap((f) => [f.q, ...f.a]),
  ].join(' ');

const shingles = (text: string) => {
  const w = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const s = new Set<string>();
  for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(' '));
  return s;
};

describe('keyword pages', () => {
  it('has the 12 PLAN §3 pages', () => {
    expect(KEYWORD_PAGES.map((p) => p.slug)).toEqual([
      'compress-video-for-discord',
      'compress-video-to-8mb',
      'compress-video-to-10mb',
      'compress-video-to-20mb',
      'compress-video-to-25mb',
      'compress-video-to-50mb',
      'compress-video-for-whatsapp',
      'compress-video-for-email',
      'reduce-video-size',
      'compress-mp4',
      'compress-mov',
      'compress-video-without-uploading',
    ]);
  });
  it('titles and descriptions are unique; ≥ 400 words each', () => {
    expect(new Set(KEYWORD_PAGES.map((p) => p.title)).size).toBe(12);
    expect(new Set(KEYWORD_PAGES.map((p) => p.description)).size).toBe(12);
    for (const p of KEYWORD_PAGES) expect(body(p).split(/\s+/).length, p.slug).toBeGreaterThanOrEqual(400);
  });
  it('pairwise 5-word shingle Jaccard < 0.5', () => {
    const sh = KEYWORD_PAGES.map((p) => shingles(body(p)));
    for (let i = 0; i < sh.length; i++)
      for (let j = i + 1; j < sh.length; j++) {
        const a = sh[i]!;
        const b = sh[j]!;
        const inter = [...a].filter((x) => b.has(x)).length;
        expect(inter / (a.size + b.size - inter)).toBeLessThan(0.5);
      }
  });
  it('related links point at real pages', () => {
    const slugs = new Set(KEYWORD_PAGES.map((p) => p.slug));
    for (const p of KEYWORD_PAGES) for (const r of p.related) expect(slugs.has(r), `${p.slug} → ${r}`).toBe(true);
  });
  it('limit numbers render from preset data', () => {
    const text = (slug: string) => JSON.stringify(KEYWORD_PAGES.find((p) => p.slug === slug));
    expect(text('compress-video-for-discord')).toContain('20 MB');
    expect(text('compress-video-for-whatsapp')).toContain('64 MB');
    expect(text('compress-video-for-whatsapp')).toContain('100 MB');
    expect(text('compress-video-for-whatsapp')).toContain('2 GB');
    expect(text('compress-video-for-email')).toContain('18 MB');
    expect(text('compress-video-for-email')).toContain('14.5 MB');
  });
});

describe('planTable', () => {
  it('comes from the real planner and gets smaller with longer clips', () => {
    const rows = planTable(10_000_000);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.feasible).toBe(true);
    expect(rows[0]!.videoKbps).toBeGreaterThan(rows[3]!.videoKbps);
  });
});

describe('per-page OG images', () => {
  it('exist for every keyword page', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const p of KEYWORD_PAGES) expect(existsSync(join(__dirname, '..', 'public', 'og', `${p.slug}.png`)), p.slug).toBe(true);
  });
});

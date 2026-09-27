import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_URL as CORE_SITE_URL } from '@snugclip/core';
import { DONATION_LINKS, SITE_URL, SUPPORT_URL } from '@/config/site';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs|css)$/.test(f)) out.push(p);
  }
  return out;
}

describe('site config', () => {
  it('re-exports SITE_URL from core and uses the shared support route', () => {
    expect(SITE_URL).toBe(CORE_SITE_URL);
    expect(SUPPORT_URL).toBe('/support/');
  });
  it('donation links are the shared Stripe links (one-time + 4 monthly tiers)', () => {
    expect(DONATION_LINKS.once).toMatch(/^https:\/\/buy\.stripe\.com\//);
    expect(DONATION_LINKS.monthly.map((m) => m.label)).toEqual(['$5', '$15', '$50', '$100']);
  });
  it('no Stripe URL or hard-coded site host anywhere else in apps/web/src', () => {
    const src = join(__dirname, '..', 'src');
    for (const f of walk(src)) {
      const text = readFileSync(f, 'utf8');
      if (!f.endsWith(join('config', 'site.ts'))) expect(text, f).not.toMatch(/buy\.stripe\.com/);
      expect(text, f).not.toMatch(/snugclip\.vercel\.app/);
    }
  });
  it('no raw size formatting outside core (one shared formatter)', () => {
    const src = join(__dirname, '..', 'src');
    for (const f of walk(src)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\/\s*1e6\)?\.toFixed|\/ 1_000_000\)\.toFixed/);
  });
});

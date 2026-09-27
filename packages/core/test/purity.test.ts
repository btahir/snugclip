// A8 (test half): core imports nothing from the host and never hard-codes the site address.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_URL, SUPPORT_URL } from '../src/index.js';

const dir = join(import.meta.dirname, '..', 'src');
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
// Drop comments and string literals ("document" is a fine word in preset notes).
const strip = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "''");

describe('core purity', () => {
  it.each(files)('%s: only relative, zod or ssim.js imports; no host globals', (f) => {
    const src = strip(readFileSync(join(dir, f), 'utf8'));
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(/^(\.\/|zod$|ssim\.js$)/);
    // Bare host globals only; injected `deps.timers.setTimeout(...)` and the Timers interface are fine.
    expect(src).not.toMatch(/(?<![.\w])(window|document|navigator|process|Buffer|require|globalThis|self|setTimeout|setInterval|fetch|URLSearchParams|localStorage)\b(?!\s*\(fn:)/);
    expect(src).not.toMatch(/from ['"](node:|fs|path|mediabunny)/);
  });
  it('the site host appears only in site.ts; no Stripe URLs', () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (f !== 'site.ts') expect(src, f).not.toMatch(/vercel\.app/);
      expect(src).not.toMatch(/stripe\.com/);
    }
    expect(SUPPORT_URL).toBe(`${SITE_URL}/support/`);
  });
});

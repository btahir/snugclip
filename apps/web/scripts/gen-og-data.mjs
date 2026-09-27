#!/usr/bin/env node
// Writes scripts/og-pages.json (headline, sub line, chips) for per-page OG images from the typed
// keyword-page data, so the images never drift from the copy or the preset numbers.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const res = await build({
  entryPoints: [join(app, 'src/content/pages/index.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  conditions: ['source'],
  alias: { '@': join(app, 'src') },
  resolveExtensions: ['.ts', '.tsx', '.js'],
  logLevel: 'error',
});
const code = res.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const out = mod.KEYWORD_PAGES.map((p) => ({
  slug: p.slug,
  h1a: p.h1 + '.',
  h1b: 'Never over.',
  sub: `${p.eyebrow.label} · ${p.eyebrow.value}. Free, in your browser, never uploaded.`,
  chips: ['Never over the limit', 'No upload', 'Free, MIT'],
  line: p.glassLabel,
}));
writeFileSync(join(app, 'scripts/og-pages.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`og-pages.json: ${out.length} pages`);

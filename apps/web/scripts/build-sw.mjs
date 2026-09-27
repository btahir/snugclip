#!/usr/bin/env node
// After `next build`: bundle src/sw.ts with esbuild into out/sw.js, then inject the Serwist
// precache manifest listing every file of the static export (HTML, JS, CSS, fonts, icons,
// the AAC encoder under /vendor, the schema and llms.txt).
import { injectManifest } from '@serwist/build';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(app, 'out');
if (!existsSync(out)) throw new Error('out/ missing: run next build first');
const swDest = join(out, 'sw.js');

await build({
  entryPoints: [join(app, 'src/sw.ts')],
  outfile: swDest,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const { count, size, warnings } = await injectManifest({
  swSrc: swDest,
  swDest,
  globDirectory: out,
  globPatterns: ['**/*.{html,js,mjs,css,woff2,svg,png,ico,json,txt,xml,webmanifest}'],
  globIgnores: ['sw.js', '**/*.map'],
  dontCacheBustURLsMatching: /^_next\/static\//,
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  // Browsers request `app/[slug]/page.js` as `app/%5Bslug%5D/page.js`; precache the encoded form.
  manifestTransforms: [
    async (entries) => ({ manifest: entries.map((e) => ({ ...e, url: e.url.replace(/\[/g, '%5B').replace(/\]/g, '%5D') })), warnings: [] }),
  ],
});
for (const w of warnings) console.warn('serwist:', w);
console.log(`sw.js: precached ${count} files, ${(size / 1e6).toFixed(2)} MB`);

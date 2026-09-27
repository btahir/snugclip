#!/usr/bin/env node
// Headless Chrome check for engine-web (installed Chrome, `channel: 'chrome'`). Heavy: run through
// research/heavy.sh. Never run this in the Claude app's in-app browser.
//
//   ../research/heavy.sh node packages/engine-web/browser-check/run.mjs            # default jobs
//   ../research/heavy.sh node packages/engine-web/browser-check/run.mjs '[["f06-rotated-1080p-10s.mp4","1MB"]]'
//
// Asserts: opening the page creates zero AudioEncoder instances (main thread and worker); every
// job fits; low-bitrate AAC goes through the WASM encoder with zero native AudioEncoders.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const FX = join(repo, 'fixtures/generated');
const out = mkdtempSync(join(tmpdir(), 'snugclip-browser-check-'));
const esbuild = join(repo, 'node_modules/.bin/esbuild');
for (const f of ['main', 'worker']) {
  execFileSync(esbuild, [join(here, `${f}.ts`), '--bundle', '--format=esm', '--conditions=source', '--platform=browser', `--outfile=${join(out, f + '.js')}`, '--log-level=warning', `--tsconfig=${join(repo, 'packages/engine-web/tsconfig.json')}`]);
}
copyFileSync(join(here, 'index.html'), join(out, 'index.html'));
mkdirSync(join(out, 'vendor'));
copyFileSync(join(repo, 'packages/engine-web/node_modules/@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.min.mjs'), join(out, 'vendor/aac-encoder-1.60.0.mjs'));

// Playwright is a dev dependency of apps/web.
const req = createRequire(join(repo, 'apps/web/package.json'));
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const server = createServer(async (rq, rs) => {
  const u = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const p = u.startsWith('/fx/') ? join(FX, u.slice(4)) : join(out, u === '/' ? 'index.html' : u);
  try {
    const b = await readFile(p);
    rs.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    rs.end(b);
  } catch {
    rs.writeHead(404);
    rs.end();
  }
}).listen(4392);

const jobs = JSON.parse(process.argv[2] ?? '[["f06-rotated-1080p-10s.mp4","1MB"],["f11-long-360p30-300s.mp4","8MB"],["f09-vp9-720p30-10s.webm","2MB"],["f01-testsrc2-1080p30-10s.mp4","2MB"]]');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = { browser: browser.version(), jobs: [], failures: [] };
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__ae = 0;
    if (window.AudioEncoder) {
      const N = window.AudioEncoder;
      window.AudioEncoder = class extends N {
        constructor(i) {
          super(i);
          window.__ae++;
        }
      };
      window.AudioEncoder.isConfigSupported = N.isConfigSupported.bind(N);
    }
  });
  page.on('crash', () => result.failures.push('page crashed'));
  await page.goto('http://localhost:4392/');
  await page.waitForFunction(() => document.title === 'READY');
  result.support = await page.evaluate(() => window.snug.support());
  const caps = await page.evaluate(() => window.snug.caps());
  result.onLoad = { mainThreadAudioEncoders: await page.evaluate(() => window.__ae), workerAudioEncoders: caps.audioEncodersCreated };
  if (result.onLoad.mainThreadAudioEncoders || result.onLoad.workerAudioEncoders) result.failures.push('AudioEncoder created on load');
  for (const [name, size] of jobs) {
    const j = await page.evaluate(([n, s]) => window.snug.run(n, s), [name, size]);
    const lowNative = (j.nativeAudioConfigs ?? []).filter((c) => c.bitrate < 96_000);
    result.jobs.push({ name, size, status: j.status, bytes: j.bytes, target: j.target, audio: j.planAudio, audioEncoder: j.lastAudioEncoder, nativeAudioEncoders: j.nativeAudioEncodersCreated, ssim: j.quality, encoder: j.encoder, ms: j.ms, error: j.error });
    if (j.status !== 'fit' && j.status !== 'passthrough') result.failures.push(`${name}@${size}: ${j.status} ${JSON.stringify(j.error)}`);
    if (j.bytes > j.target) result.failures.push(`${name}@${size}: over target`);
    if (lowNative.length) result.failures.push(`${name}@${size}: native AAC below 96 kbps`);
  }
} catch (e) {
  result.failures.push(String(e));
} finally {
  await browser.close();
  server.close();
  rmSync(out, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 1));
process.exit(result.failures.length ? 1 : 0);

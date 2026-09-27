#!/usr/bin/env node
// Verifier: web-engine size-guarantee matrix in installed Chrome (ACCEPTANCE B1, B2, B3).
// Heavy: run ONLY through research/heavy.sh, headless. Never in the Claude in-app browser.
//
//   ../research/heavy.sh node scripts/verify/web-matrix/run.mjs                 # items from test-results/matrix-cli.json + B2/B3
//   ../research/heavy.sh node scripts/verify/web-matrix/run.mjs F01 F03         # only these fixtures
//
// Per item (checked on the real output file with ffprobe/ffmpeg, not on the report alone):
//   size ≤ target · duration ±1 frame · clean re-decode (ffmpeg -v error, empty stderr) ·
//   frame count within ±1 of D·fps · SSIM floor for the achieved tier (PLAN §5) ·
//   pass-through is byte-identical (SHA-256) · F15/F16/F17 → unsupported.
// Writes test-results/matrix-web.json incrementally.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const FX = join(repo, 'fixtures/generated');
const PORT = 4393;
const only = process.argv.filter((a) => /^F\d\d$/i.test(a)).map((a) => a.toUpperCase());
const tmp = mkdtempSync(join(tmpdir(), 'snugclip-verify-webmatrix-'));
const site = join(tmp, 'site');
const outs = join(tmp, 'outs');
mkdirSync(site);
mkdirSync(outs);
const esbuild = join(repo, 'node_modules/.bin/esbuild');
for (const f of ['main', 'worker']) {
  execFileSync(esbuild, [join(here, `${f}.ts`), '--bundle', '--format=esm', '--conditions=source', '--platform=browser', `--outfile=${join(site, f + '.js')}`, '--log-level=warning', `--tsconfig=${join(repo, 'packages/engine-web/tsconfig.json')}`]);
}
copyFileSync(join(here, 'index.html'), join(site, 'index.html'));
mkdirSync(join(site, 'vendor'));
copyFileSync(join(repo, 'packages/engine-web/node_modules/@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.min.mjs'), join(site, 'vendor/aac-encoder-1.60.0.mjs'));

const req = createRequire(join(repo, 'apps/web/package.json'));
const pw = await import(pathToFileURL(req.resolve('@playwright/test')).href);
const chromium = pw.chromium ?? pw.default.chromium;

const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' };
const server = createServer(async (rq, rs) => {
  const u = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (rq.method === 'POST' && u.startsWith('/upload/')) {
    const chunks = [];
    for await (const c of rq) chunks.push(c);
    await writeFile(join(outs, u.slice(8).replace(/[^\w.-]/g, '_')), Buffer.concat(chunks));
    rs.writeHead(204);
    rs.end();
    return;
  }
  const p = u.startsWith('/fx/') ? join(FX, u.slice(4)) : join(site, u === '/' ? 'index.html' : u);
  try {
    const b = await readFile(p);
    rs.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    rs.end(b);
  } catch {
    rs.writeHead(404);
    rs.end();
  }
}).listen(PORT);

// ---- items ----
const manifest = JSON.parse(readFileSync(join(FX, 'manifest.json'), 'utf8')).fixtures;
const byId = Object.fromEntries(manifest.map((f) => [f.id, f]));
const cliPath = join(repo, 'test-results/matrix-cli.json');
if (!existsSync(cliPath)) throw new Error('Run the CLI matrix first (test-results/matrix-cli.json supplies the item list).');
const cliRows = JSON.parse(readFileSync(cliPath, 'utf8')).rows;
const cliItems = process.env.VERIFY_ITEMS ? JSON.parse(process.env.VERIFY_ITEMS) : null;
const items = (cliItems ?? cliRows).map((r) => ({ fixture: r.fixture, file: r.file, target: r.target, why: r.why, options: {} }));
items.push({ fixture: 'F12', file: byId.F12.file, target: 10_000_000, why: 'B2 passthrough 10MB', options: {} });
items.push({ fixture: 'F01', file: byId.F01.file, target: 500_000_000, why: 'B2 discord-nitro', options: {} });
items.push({ fixture: 'F01', file: byId.F01.file, target: 1_000_000, why: 'B3 trim 2.0-7.5', options: { trim: { startSec: 2, endSec: 7.5 } } });
const todo = items.filter((i) => !only.length || only.includes(i.fixture));

const K = { h264: 1, vp9: 0.7, hevc: 0.6, av1: 0.55 };
const FLOORS = { A: { mean: 0.9, min: 0.8 }, B: { mean: 0.82, min: 0.7 }, F02: { mean: 0.3, min: 0.2 } };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function ffprobe(p) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-print_format', 'json', '-show_format', '-show_streams', p], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return JSON.parse(r.stdout || '{}');
}
function decodesCleanly(p) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-threads', '4', '-i', p, '-f', 'null', '-'], { encoding: 'utf8' });
  return { ok: r.status === 0 && r.stderr.trim() === '', stderr: r.stderr.trim().slice(0, 300) };
}

let browser;
let page;
let crashed = false;
async function launch() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  crashed = false;
  page.on('crash', () => (crashed = true));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => document.title === 'READY');
}

const resultPath = join(repo, process.env.VERIFY_ITEMS ? 'test-results/verify/matrix-web-adhoc.json' : 'test-results/matrix-web.json');
const rows = [];
const t0 = Date.now();
let meta = {};
function save(done = false) {
  const count = (f) => rows.filter(f).length;
  const fits = rows.filter((r) => r.status === 'fit');
  const worst = {};
  for (const r of fits) if (r.quality && r.tier && (!worst[r.tier] || r.quality.ssimMean < worst[r.tier].ssimMean)) worst[r.tier] = { fixture: r.fixture, target: r.target, ...r.quality };
  const summary = {
    generated: new Date().toISOString(), done, ...meta,
    items: rows.length, passed: count((r) => r.ok), failed: count((r) => !r.ok),
    fit: fits.length, passthrough: count((r) => r.status === 'passthrough'), impossible: count((r) => r.status === 'impossible'),
    unsupported: count((r) => r.status === 'unsupported'), other: count((r) => !['fit', 'passthrough', 'impossible', 'unsupported'].includes(r.status)),
    overTarget: count((r) => r.outputBytes != null && r.outputBytes > r.target),
    maxBytesToTarget: Math.max(0, ...rows.filter((r) => r.status === 'fit').map((r) => r.ratio ?? 0)),
    worstSsimByTier: worst, elapsedSec: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, JSON.stringify({ summary, rows }, null, 2) + '\n');
  return summary;
}

try {
  await launch();
  meta = { browser: browser.version(), support: await page.evaluate(() => window.snug.support()) };
  for (const [n, it] of todo.entries()) {
    const key = `${n}-${it.fixture}-${it.target}`;
    const ts = Date.now();
    let r;
    try {
      r = await Promise.race([
        page.evaluate(([k, f, b, o]) => window.snug.run(k, f, b, o), [key, it.file, it.target, it.options]),
        new Promise((_, rej) => setTimeout(() => rej(new Error('item timeout 600 s')), 600_000)),
      ]);
    } catch (e) {
      r = { error: { code: crashed ? 'PAGE_CRASH' : 'HARNESS', message: String(e).slice(0, 300) } };
      await launch();
    }
    const rep = r.report;
    const row = { fixture: it.fixture, file: it.file, target: it.target, why: it.why, options: it.options, status: rep?.status ?? 'crash', ok: false, checks: {}, ms: Date.now() - ts };
    if (!rep) row.error = r.error;
    else {
      row.error = rep.error ? { code: rep.error.code, message: rep.error.message } : undefined;
      row.passThrough = rep.passThrough;
      row.fits = rep.fits;
      row.outputBytes = rep.output?.bytes ?? null;
      row.ratio = rep.output ? Math.round((rep.output.bytes / it.target) * 10000) / 10000 : null;
      row.attempts = rep.attempts.filter((a) => a.purpose !== 'calibration').length;
      row.minimumBytes = rep.minimumBytes ?? rep.plan?.minimumBytes;
      row.quality = rep.quality ? { ssimMean: rep.quality.ssimMean, ssimMin: rep.quality.ssimMin, psnrMean: rep.quality.psnrMean, verdict: rep.quality.verdict } : null;
      row.video = rep.output?.video ?? null;
      row.audio = rep.output?.audio ?? null;
      row.encoder = rep.engine?.encoder;
      row.audioEncoder = r.lastAudioEncoder;
      row.plan = rep.plan ? { container: rep.plan.container, codec: rep.plan.video?.codec, w: rep.plan.video?.width, h: rep.plan.video?.height, fps: rep.plan.video?.fps, bppTier: rep.plan.video?.bppTier, audio: rep.plan.audio?.mode } : null;
      const expectUnsupported = ['F15', 'F16', 'F17'].includes(it.fixture);
      if (expectUnsupported) {
        row.ok = rep.status === 'unsupported' && !!rep.error?.message;
      } else if (rep.status === 'impossible') {
        row.checks.expectedImpossible = it.why === '0.95×min';
        row.ok = row.outputBytes == null && (it.why === '0.95×min' || (row.minimumBytes ?? 0) > it.target);
      } else if (rep.status === 'fit' || rep.status === 'passthrough') {
        const c = row.checks;
        const file = join(outs, key.replace(/[^\w.-]/g, '_'));
        c.uploaded = existsSync(file);
        if (c.uploaded) {
          c.size = readFileSync(file).length === rep.output.bytes && rep.output.bytes <= it.target;
          const p = ffprobe(file);
          const vs = (p.streams ?? []).find((s) => s.codec_type === 'video');
          const durOut = Number(p.format?.duration);
          const trim = it.options.trim;
          const durExp = trim ? trim.endSec - trim.startSec : rep.passThrough ? rep.input.probe.durationSec : rep.plan.durationSec;
          const [fn, fd] = (vs?.avg_frame_rate ?? '30/1').split('/').map(Number);
          const fpsOut = fn / (fd || 1);
          c.duration = Math.abs(durOut - durExp) <= 1 / fpsOut + 0.03;
          row.durationOut = durOut;
          row.durationExpected = durExp;
          const dec = decodesCleanly(file);
          c.decode = dec.ok;
          if (!dec.ok) row.decodeErr = dec.stderr;
          const frames = Number(vs?.nb_read_frames);
          row.frames = frames;
          row.framesExpected = Math.round(durExp * fpsOut * 100) / 100;
          c.frameCount = Math.abs(frames - durExp * fpsOut) <= 1.5; // ±1 frame (+ rounding of D·fps)
          if (rep.status === 'passthrough') c.byteIdentical = sha(file) === sha(join(FX, it.file));
          if (rep.status === 'fit') {
            const v = rep.output.video;
            const vbits = vs?.bit_rate ? Number(vs.bit_rate) : (rep.output.bytes * 8) / durOut;
            const bppk = vbits / (v.width * v.height * v.fps) / (K[v.codec] ?? 1);
            row.tier = it.fixture === 'F02' ? 'F02' : bppk >= 0.08 ? 'A' : 'B';
            row.bppK = Math.round(bppk * 10000) / 10000;
            const floor = FLOORS[row.tier];
            c.ssim = !!rep.quality && rep.quality.ssimMean >= floor.mean && rep.quality.ssimMin >= floor.min;
          }
          if (process.env.VERIFY_KEEP) copyFileSync(file, join(process.env.VERIFY_KEEP, `${key}.out`));
          rmSync(file, { force: true });
        }
        row.ok = Object.values(c).every(Boolean);
      }
    }
    rows.push(row);
    const q = row.quality ? ` ssim ${row.quality.ssimMean?.toFixed(4)}/${row.quality.ssimMin?.toFixed(4)}` : '';
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${it.fixture} ${String(it.target).padStart(10)} ${it.why.padEnd(20)} ${row.status.padEnd(11)} ${row.outputBytes ?? ''}${row.ratio ? ` (${row.ratio})` : ''}${row.video ? ` ${row.video.codec} ${row.video.width}x${row.video.height}@${row.video.fps}` : ''}${q}${row.tier ? ` tier ${row.tier}` : ''} ${row.attempts ? `att ${row.attempts}` : ''} ${row.audioEncoder ?? ''} ${row.ms}ms${row.ok ? '' : ` ${JSON.stringify(row.checks)} ${JSON.stringify(row.error ?? '')}`}`);
    save(false);
  }
} finally {
  await browser?.close().catch(() => {});
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
const summary = save(true);
console.log('\n' + JSON.stringify(summary, null, 2));
process.exit(summary.failed ? 1 : 0);

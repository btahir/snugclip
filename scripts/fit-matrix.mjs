#!/usr/bin/env node
// CLI fit matrix (ACCEPTANCE C1 / PLAN §11): every fixture × targets through the built
// `snugclip compress --json`, with the per-item checks run on the real output:
//   size ≤ target · duration ±1 frame (ffprobe) · clean re-decode (ffmpeg -v error -f null) ·
//   SSIM floor for the achieved tier (PLAN §5).
// Writes test-results/matrix-cli.json and prints a summary. Heavy: run via research/heavy.sh.
//
//   ../research/heavy.sh node scripts/fit-matrix.mjs            # PLAN matrix + 8/10/25 MB
//   ../research/heavy.sh node scripts/fit-matrix.mjs --quick    # only 8/10/25 MB
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'packages/cli/bin/snugclip.js');
const FX = join(root, 'fixtures/generated');
const quick = process.argv.includes('--quick');
const only = process.argv.filter((a) => /^F\d\d$/i.test(a)).map((a) => a.toUpperCase());
if (!existsSync(join(root, 'packages/cli/dist/main.js'))) {
  console.error('Build first: pnpm build');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(FX, 'manifest.json'), 'utf8')).fixtures;
const MB = 1_000_000;
const PRESET_BYTES = [8, 10, 14.5, 18, 20, 25, 50, 64, 100, 500, 1000, 2000, 4000].map((n) => Math.round(n * MB));
const K = { h264: 1, vp9: 0.7, hevc: 0.6, av1: 0.55 };
const FLOORS = { A: { mean: 0.9, min: 0.8 }, B: { mean: 0.82, min: 0.7 }, F02: { mean: 0.3, min: 0.2 } };
const out = mkdtempSync(join(tmpdir(), 'snugclip-matrix-'));

function cli(args) {
  const r = spawnSync(process.execPath, [bin, ...args, '--json', '--out-dir', out, '--overwrite'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  let doc = null;
  try {
    doc = JSON.parse(r.stdout);
  } catch {}
  return { code: r.status, doc, stderr: r.stderr };
}
function ffprobe(p) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p], { encoding: 'utf8' });
  return JSON.parse(r.stdout);
}
function decodesCleanly(p) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', p, '-threads', '4', '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0 && r.stderr.trim() === '';
}

const rows = [];
const t0 = Date.now();
for (const fx of manifest) {
  if (only.length && !only.includes(fx.id)) continue;
  const path = join(FX, fx.file);
  const unsupportedExpected = fx.id === 'F16' || fx.id === 'F17';
  const targets = new Map();
  for (const n of [8, 10, 25]) targets.set(n * MB, `${n}MB`);
  if (!quick && !unsupportedExpected) {
    for (const b of PRESET_BYTES) if (!targets.has(b)) targets.set(b, `preset ${b / MB}MB`);
    for (const f of [0.5, 0.25, 0.1]) {
      const b = Math.round(fx.bytes * f);
      if (b >= 10_000 && !targets.has(b)) targets.set(b, `${f}×size`);
    }
    const plan = cli(['plan', path, '--size', `${Math.max(fx.bytes, 10_000)}B`]);
    const min = plan.doc?.results?.[0]?.plan?.minimumBytes;
    if (min) {
      for (const f of [1.05, 0.95]) {
        const b = Math.round(min * f);
        if (b >= 10_000 && !targets.has(b)) targets.set(b, `${f}×min`);
      }
    }
  }
  for (const [bytes, why] of [...targets.entries()].sort((a, b) => a[0] - b[0])) {
    const ts = Date.now();
    const r = cli(['compress', path, '--size', `${bytes}B`]);
    const rep = r.doc?.results?.[0];
    const row = { fixture: fx.id, file: fx.file, sourceBytes: fx.bytes, target: bytes, why, exit: r.code, status: rep?.status ?? 'crash', ok: false, checks: {}, ms: Date.now() - ts };
    if (!rep) row.error = r.stderr.slice(-500) || JSON.stringify(r.doc?.error);
    else {
      row.error = rep.error?.code;
      row.outputBytes = rep.output?.bytes ?? null;
      row.ratio = rep.output ? Math.round((rep.output.bytes / bytes) * 10000) / 10000 : null;
      row.attempts = rep.attempts.filter((a) => a.purpose !== 'calibration').length;
      row.minimumBytes = rep.minimumBytes;
      row.quality = rep.quality ? { ssimMean: rep.quality.ssimMean, ssimMin: rep.quality.ssimMin, psnrMean: rep.quality.psnrMean, verdict: rep.quality.verdict } : null;
      row.video = rep.output?.video ?? null;
      if (unsupportedExpected) {
        row.ok = rep.status === 'unsupported' && r.code === 3;
      } else if (rep.status === 'impossible') {
        row.ok = r.code === 2 && why === '0.95×min' ? true : r.code === 2 && rep.minimumBytes > bytes;
        row.checks.expectedImpossible = why === '0.95×min';
      } else if (rep.status === 'fit' || rep.status === 'passthrough') {
        const c = row.checks;
        c.size = rep.output.bytes <= bytes;
        const p = ffprobe(rep.output.path);
        const vs = p.streams.find((s) => s.codec_type === 'video');
        const durOut = Number(p.format.duration);
        const durExp = rep.passThrough ? rep.input.probe.durationSec : rep.plan.durationSec;
        const fpsOut = vs ? Number(vs.avg_frame_rate.split('/')[0]) / Number(vs.avg_frame_rate.split('/')[1] || 1) : 30;
        c.duration = Math.abs(durOut - durExp) <= 1 / fpsOut + 0.03; // ±1 frame (+ container rounding)
        row.durationOut = durOut;
        c.decode = decodesCleanly(rep.output.path);
        if (rep.status === 'fit') {
          const v = rep.output.video;
          const vbits = vs?.bit_rate ? Number(vs.bit_rate) : (rep.attempts.find((a) => a.bytes === rep.output.bytes)?.videoBytes ?? rep.output.bytes) * 8 / durOut;
          const bppk = vbits / (v.width * v.height * v.fps) / K[v.codec];
          row.tier = fx.id === 'F02' ? 'F02' : bppk >= 0.08 ? 'A' : 'B';
          row.bppK = Math.round(bppk * 10000) / 10000;
          const floor = FLOORS[row.tier];
          c.ssim = !!rep.quality && rep.quality.ssimMean >= floor.mean && rep.quality.ssimMin >= floor.min;
        }
        row.ok = r.code === 0 && Object.values(c).every(Boolean);
        rmSync(rep.output.path, { force: true });
      }
    }
    rows.push(row);
    const q = row.quality ? ` ssim ${row.quality.ssimMean}/${row.quality.ssimMin}` : '';
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${fx.id} ${String(bytes).padStart(10)} ${why.padEnd(14)} ${row.status.padEnd(11)} ${row.outputBytes ?? ''}${row.ratio ? ` (${row.ratio})` : ''}${row.video ? ` ${row.video.width}x${row.video.height}@${row.video.fps}` : ''}${q}${row.tier ? ` tier ${row.tier}` : ''} ${row.attempts ? `att ${row.attempts}` : ''} ${row.ms}ms${row.ok ? '' : ` ${JSON.stringify(row.checks)} ${row.error ?? ''}`}`);
  }
}
rmSync(out, { recursive: true, force: true });

const count = (f) => rows.filter(f).length;
const fits = rows.filter((r) => r.status === 'fit');
const worst = {};
for (const r of fits) if (r.quality && (!worst[r.tier] || r.quality.ssimMean < worst[r.tier].ssimMean)) worst[r.tier] = { fixture: r.fixture, target: r.target, ...r.quality };
const summary = {
  generated: new Date().toISOString(),
  items: rows.length,
  passed: count((r) => r.ok),
  failed: count((r) => !r.ok),
  fit: fits.length,
  passthrough: count((r) => r.status === 'passthrough'),
  impossible: count((r) => r.status === 'impossible'),
  unsupported: count((r) => r.status === 'unsupported'),
  overTarget: count((r) => r.outputBytes != null && r.outputBytes > r.target),
  maxBytesToTarget: Math.max(0, ...rows.filter((r) => r.ratio).map((r) => r.ratio)),
  meanFitRatio: fits.length ? Math.round((fits.reduce((s, r) => s + r.ratio, 0) / fits.length) * 10000) / 10000 : null,
  worstSsimByTier: worst,
  elapsedSec: Math.round((Date.now() - t0) / 1000),
};
mkdirSync(join(root, 'test-results'), { recursive: true });
writeFileSync(join(root, 'test-results', quick ? 'matrix-cli-quick.json' : 'matrix-cli.json'), JSON.stringify({ summary, rows }, null, 2) + '\n');
console.log('\n' + JSON.stringify(summary, null, 2));
process.exit(summary.failed ? 1 : 0);

#!/usr/bin/env node
// Verifier: ACCEPTANCE C2 (identical verdict fields web vs CLI) and an end-to-end form of D1
// (same plan fields for the same fixture × target). Reads test-results/matrix-{web,cli}.json and
// asks the built CLI for its plan per item (`snugclip plan --json`, no encode). Light: ffprobe only.
//
//   node scripts/verify/consistency.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const bin = join(root, 'packages/cli/bin/snugclip.js');
const FX = join(root, 'fixtures/generated');
const web = JSON.parse(readFileSync(join(root, 'test-results/matrix-web.json'), 'utf8')).rows;
const cli = JSON.parse(readFileSync(join(root, 'test-results/matrix-cli.json'), 'utf8')).rows;
const key = (r) => `${r.fixture}@${r.target}`;
const cliBy = new Map(cli.map((r) => [key(r), r]));
const exitClass = (s) => ({ fit: 0, passthrough: 0, impossible: 2, unsupported: 3 })[s] ?? 1;
const VERD = ['soft', 'softer', 'great'];

const verdictDiffs = [];
const statusDiffs = [];
const excluded = [];
const planDiffs = [];
let compared = 0;
let planCompared = 0;
for (const w of web) {
  if (w.why.startsWith('B2') || w.why.startsWith('B3')) continue;
  const c = cliBy.get(key(w));
  if (!c) continue;
  // F15 (MPEG-2): the web engine can't decode it by design (friendly message); the CLI fits it.
  if (w.fixture === 'F15') { excluded.push(`${key(w)} web=${w.status} cli=${c.status} (MPEG-2: no WebCodecs decoder, by design)`); continue; }
  compared++;
  const wf = { status: w.status, fits: w.status === 'fit' || w.status === 'passthrough', passThrough: w.status === 'passthrough', exit: exitClass(w.status) };
  const cf = { status: c.status, fits: c.status === 'fit' || c.status === 'passthrough', passThrough: c.status === 'passthrough', exit: c.exit };
  if (JSON.stringify(wf) !== JSON.stringify(cf)) statusDiffs.push(`${key(w)} (${w.why}): web ${JSON.stringify(wf)} vs cli ${JSON.stringify(cf)}`);
  if (w.quality && c.quality) {
    const d = Math.abs(VERD.indexOf(w.quality.verdict) - VERD.indexOf(c.quality.verdict));
    if (d > 0) verdictDiffs.push(`${key(w)}: web ${w.quality.verdict} (${w.quality.ssimMean}) vs cli ${c.quality.verdict} (${c.quality.ssimMean})${d > 1 ? ' ← 2 levels' : ''}`);
  }
  if (w.status === 'fit' && w.plan) {
    const r = spawnSync(process.execPath, [bin, 'plan', join(FX, w.file), '--size', `${w.target}B`, '--json'], { encoding: 'utf8' });
    const p = JSON.parse(r.stdout).results[0].plan;
    const cp = { container: p.container, codec: p.video?.codec, w: p.video?.width, h: p.video?.height, fps: p.video?.fps, bppTier: p.video?.bppTier, audio: p.audio?.mode };
    const wp = w.plan;
    planCompared++;
    const fields = Object.keys(cp).filter((k) => String(cp[k]) !== String(wp[k]));
    if (fields.length) planDiffs.push(`${key(w)} (${w.why}): ${fields.map((k) => `${k} web=${wp[k]} cli=${cp[k]}`).join(', ')}`);
  }
}
const out = { compared, statusDiffs, verdictDiffs, excluded, planCompared, planDiffs };
writeFileSync(join(root, 'test-results/consistency.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`C2: ${compared} items compared; status/fits/passThrough/exit differences: ${statusDiffs.length}`);
for (const d of statusDiffs) console.log('  ' + d);
console.log(`C2: quality verdict differences (listed, not failed): ${verdictDiffs.length}`);
for (const d of verdictDiffs) console.log('  ' + d);
console.log(`excluded: ${excluded.length}`);
for (const d of excluded) console.log('  ' + d);
console.log(`D1 (end-to-end): ${planCompared} fitted items; initial-plan field differences: ${planDiffs.length}`);
for (const d of planDiffs) console.log('  ' + d);
process.exit(statusDiffs.length || verdictDiffs.some((d) => d.includes('2 levels')) ? 1 : 0);

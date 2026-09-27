#!/usr/bin/env node
// Licence gate: fails if any installed dependency (prod or dev, every workspace package) has a
// licence outside the allowlist, or if a banned package appears anywhere in the tree.
//   pnpm licenses:check            # human output
//   pnpm licenses:check --json     # machine output
import { execFileSync } from 'node:child_process';

const ALLOWED = [
  'MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD', 'ISC', 'MPL-2.0', '0BSD',
  'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0', 'Python-2.0', 'CC-BY-4.0',
  // Self-hosted fonts (PLAN §10: fonts must be OFL or MIT).
  'OFL-1.1',
];
// LGPL is allowed only for the separately loaded AAC encoder WASM (BRIEF: Firefox AAC strategy).
const LGPL_EXCEPTIONS = new Set(['@mediabunny/aac-encoder']);
// Banned regardless of what their package.json claims (BRIEF "Banned").
const BANNED = new Set(['@ffmpeg/core', '@ffmpeg/ffmpeg', '@napi-rs/webcodecs', '@mediabunny/server', 'node-av', 'fdk-aac', '@imgly/background-removal']);

function isAllowed(expr, name) {
  if (!expr) return false;
  const clean = expr.replace(/[()]/g, ' ').trim();
  // SPDX "A OR B": any allowed option suffices. "A AND B": all must be allowed.
  if (/\sOR\s/i.test(clean)) return clean.split(/\s+OR\s+/i).some((p) => isAllowed(p, name));
  if (/\sAND\s/i.test(clean)) return clean.split(/\s+AND\s+/i).every((p) => isAllowed(p, name));
  const id = clean.replace(/\+$/, '');
  if (ALLOWED.includes(id)) return true;
  if (/^LGPL/i.test(id) && LGPL_EXCEPTIONS.has(name)) return true;
  return false;
}

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const data = JSON.parse(raw);
const rows = [];
for (const [license, pkgs] of Object.entries(data)) {
  for (const p of pkgs) rows.push({ name: p.name, versions: p.versions, license: p.license ?? license });
}
const bad = rows.filter((r) => !isAllowed(r.license, r.name));
const banned = rows.filter((r) => BANNED.has(r.name));
const counts = {};
for (const r of rows) counts[r.license] = (counts[r.license] ?? 0) + 1;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: !bad.length && !banned.length, total: rows.length, counts, disallowed: bad, banned }, null, 2));
} else {
  console.log(`Checked ${rows.length} packages: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const r of bad) console.log(`  DISALLOWED  ${r.name}@${r.versions.join(',')}  ${r.license}`);
  for (const r of banned) console.log(`  BANNED      ${r.name}@${r.versions.join(',')}`);
  console.log(bad.length || banned.length ? 'Licence check FAILED' : 'Licence check passed');
}
process.exit(bad.length || banned.length ? 1 : 0);

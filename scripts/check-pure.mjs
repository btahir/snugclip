#!/usr/bin/env node
// `pnpm check:pure` (PLAN §9): the core must not touch DOM or Node APIs.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('../packages/core/src/', import.meta.url).pathname;
const bad = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (/node:|from ["']fs["']|from ["']path["']|window\.|document\.|process\.|\bBuffer\b|\brequire\(/.test(code)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}
if (bad.length) {
  console.error('Core purity check failed:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('Core purity check passed (packages/core/src).');

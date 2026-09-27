#!/usr/bin/env node
// `pnpm gen:schema` (PLAN §6): writes the published job-file JSON Schema, generated from the
// core's zod schema, to apps/web/public/schema/job.v1.json. Never hand-edit the output.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(join(root, 'packages/core/dist/index.js')).href).catch(() => {
  console.error('Build the core first: pnpm --filter @snugclip/core build');
  process.exit(1);
});
const schema = { ...core.jsonSchemas().job, $id: core.JOB_SCHEMA_URL, title: 'Snugclip job file v1' };
const out = process.argv[2] ?? join(root, 'apps/web/public/schema/job.v1.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(schema, null, 2) + '\n');
console.log(`wrote ${out}`);

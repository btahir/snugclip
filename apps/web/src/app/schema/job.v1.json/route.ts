// Publishes the job file JSON Schema, generated from core's Zod schema (never hand-written).
import { JOB_SCHEMA_URL, jsonSchemas } from '@snugclip/core';

export const dynamic = 'force-static';

export function GET() {
  const schema = { ...jsonSchemas().job, $id: JOB_SCHEMA_URL, title: 'Snugclip job file v1' };
  return new Response(JSON.stringify(schema, null, 2) + '\n', { headers: { 'content-type': 'application/schema+json; charset=utf-8' } });
}

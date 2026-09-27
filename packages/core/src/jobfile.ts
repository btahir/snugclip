// Job files (`*.snugclip.json`), schema version 1. An agent writes one to hand a person a
// ready setup; the web app and CLI read it; a run can append its reports. Round-trip tested.
import { JOB_SCHEMA_VERSION, SITE_URL } from './constants.js';
import { SnugclipError } from './errors.js';
import { CODEC_CHOICES, resolveTarget } from './options.js';
import type { CodecChoice, FpsPolicy, Report, ResolvedOptions, Target } from './types.js';

export const JOB_SCHEMA_URL = `${SITE_URL}/schema/job-v1.json`;

export interface JobFile {
  $schema?: string;
  kind: 'snugclip.job';
  version: 1;
  target: Target;
  options: ResolvedOptions;
  /** Input file paths or names (relative paths resolve against the job file's folder). */
  inputs?: string[];
  /** Reports appended after a run. */
  reports?: Report[];
  /** Free text for the person opening it. */
  note?: string;
}

/** JSON Schema (draft 2020-12) for job files v1. Published in AGENTS.md. */
export const JOB_SCHEMA_V1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: JOB_SCHEMA_URL,
  title: 'Snugclip job file v1',
  type: 'object',
  required: ['kind', 'version', 'target'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    kind: { const: 'snugclip.job' },
    version: { const: 1 },
    target: {
      description: 'Where the file is going. Give bytes, a size string, or a preset id.',
      type: 'object',
      additionalProperties: false,
      properties: {
        bytes: { type: 'integer', minimum: 10000 },
        size: { type: 'string', description: 'e.g. "10MB", "9.5MiB"' },
        presetId: { type: 'string', description: 'e.g. "discord-free"; see `snugclip presets`' },
        preset: { type: 'string', description: 'alias of presetId' },
        label: { type: 'string' },
      },
    },
    options: {
      type: 'object',
      additionalProperties: false,
      properties: {
        codec: { enum: CODEC_CHOICES },
        maxHeight: { type: ['integer', 'null'], minimum: 64 },
        fps: { oneOf: [{ enum: ['auto', 'keep'] }, { type: 'number', exclusiveMinimum: 0, maximum: 240 }] },
        trim: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              required: ['start', 'end'],
              additionalProperties: false,
              properties: { start: { type: 'number', minimum: 0 }, end: { type: 'number', exclusiveMinimum: 0 } },
            },
          ],
        },
        mute: { type: 'boolean' },
        reencode: { type: 'boolean' },
      },
    },
    inputs: { type: 'array', items: { type: 'string' } },
    reports: { type: 'array', items: { type: 'object' } },
    note: { type: 'string' },
  },
} as const;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const DEFAULT_OPTIONS: ResolvedOptions = { codec: 'compatible', maxHeight: null, fps: 'auto', trim: null, mute: false, reencode: false };

/** Validates an already-parsed value. Returns the normalised job or a list of problems. */
export function validateJob(value: unknown): { ok: true; job: JobFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ['job file must be a JSON object'] };
  const allowed = new Set(['$schema', 'kind', 'version', 'target', 'options', 'inputs', 'reports', 'note']);
  for (const k of Object.keys(value)) if (!allowed.has(k)) errors.push(`unknown field "${k}"`);
  if (value.kind !== 'snugclip.job') errors.push('kind must be "snugclip.job"');
  if (value.version !== JOB_SCHEMA_VERSION) {
    errors.push(
      typeof value.version === 'number' && value.version > JOB_SCHEMA_VERSION
        ? `job file version ${value.version} is newer than this Snugclip understands (${JOB_SCHEMA_VERSION}); update Snugclip`
        : `version must be ${JOB_SCHEMA_VERSION}`,
    );
  }
  let target: Target | null = null;
  if (!isObj(value.target)) errors.push('target must be an object with bytes, size or presetId');
  else {
    const t = value.target;
    for (const k of Object.keys(t)) if (!['bytes', 'size', 'presetId', 'preset', 'label'].includes(k)) errors.push(`target: unknown field "${k}"`);
    try {
      if (t.bytes !== undefined && !(typeof t.bytes === 'number' && Number.isInteger(t.bytes))) throw new SnugclipError('INVALID_JOB_FILE', 'target.bytes must be an integer');
      const presetId = (t.presetId ?? t.preset) as string | undefined;
      if (typeof t.bytes === 'number') {
        target = resolveTarget({ bytes: t.bytes });
        if (typeof presetId === 'string') target.presetId = presetId;
      } else if (typeof t.size === 'string') target = resolveTarget({ size: t.size });
      else if (typeof presetId === 'string') target = resolveTarget({ preset: presetId });
      else throw new SnugclipError('INVALID_JOB_FILE', 'target needs bytes, size or presetId');
      if (typeof t.label === 'string') target.label = t.label;
    } catch (e) {
      errors.push(`target: ${(e as Error).message}`);
    }
  }
  const options: ResolvedOptions = { ...DEFAULT_OPTIONS };
  if (value.options !== undefined) {
    if (!isObj(value.options)) errors.push('options must be an object');
    else {
      const o = value.options;
      for (const k of Object.keys(o)) if (!(k in DEFAULT_OPTIONS)) errors.push(`options: unknown field "${k}"`);
      if (o.codec !== undefined) {
        if (typeof o.codec === 'string' && (CODEC_CHOICES as readonly string[]).includes(o.codec)) options.codec = o.codec as CodecChoice;
        else errors.push(`options.codec must be one of ${CODEC_CHOICES.join(', ')}`);
      }
      if (o.maxHeight !== undefined) {
        if (o.maxHeight === null) options.maxHeight = null;
        else if (typeof o.maxHeight === 'number' && Number.isInteger(o.maxHeight) && o.maxHeight >= 64) options.maxHeight = o.maxHeight;
        else errors.push('options.maxHeight must be null or an integer ≥ 64');
      }
      if (o.fps !== undefined) {
        if (o.fps === 'auto' || o.fps === 'keep') options.fps = o.fps as FpsPolicy;
        else if (typeof o.fps === 'number' && o.fps > 0 && o.fps <= 240) options.fps = o.fps;
        else errors.push('options.fps must be "auto", "keep" or a number in (0, 240]');
      }
      if (o.trim !== undefined) {
        if (o.trim === null) options.trim = null;
        else if (isObj(o.trim) && typeof o.trim.start === 'number' && typeof o.trim.end === 'number' && o.trim.start >= 0 && o.trim.end > o.trim.start) {
          options.trim = { start: o.trim.start, end: o.trim.end };
        } else errors.push('options.trim must be null or {start, end} with 0 ≤ start < end (seconds)');
      }
      for (const k of ['mute', 'reencode'] as const) {
        if (o[k] !== undefined) {
          if (typeof o[k] === 'boolean') options[k] = o[k] as boolean;
          else errors.push(`options.${k} must be a boolean`);
        }
      }
    }
  }
  if (value.inputs !== undefined && !(Array.isArray(value.inputs) && value.inputs.every((s) => typeof s === 'string'))) {
    errors.push('inputs must be an array of strings');
  }
  if (value.reports !== undefined && !(Array.isArray(value.reports) && value.reports.every(isObj))) errors.push('reports must be an array of report objects');
  if (value.note !== undefined && typeof value.note !== 'string') errors.push('note must be a string');
  if (errors.length || !target) return { ok: false, errors: errors.length ? errors : ['target is missing'] };
  const job: JobFile = { $schema: JOB_SCHEMA_URL, kind: 'snugclip.job', version: 1, target, options };
  if (value.inputs !== undefined) job.inputs = [...(value.inputs as string[])];
  if (value.reports !== undefined) job.reports = value.reports as unknown as Report[];
  if (typeof value.note === 'string') job.note = value.note;
  return { ok: true, job };
}

/** Parses job file text. Throws SnugclipError('INVALID_JOB_FILE') listing every problem. */
export function parseJob(text: string): JobFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new SnugclipError('INVALID_JOB_FILE', `Job file is not valid JSON: ${(e as Error).message}`);
  }
  const r = validateJob(value);
  if (!r.ok) throw new SnugclipError('INVALID_JOB_FILE', `Invalid job file: ${r.errors.join('; ')}`, { errors: r.errors });
  return r.job;
}

/** Creates a job from a target and options (defaults filled in). */
export function createJob(target: Target, options: Partial<ResolvedOptions> = {}, extra: { inputs?: string[]; note?: string } = {}): JobFile {
  const job: JobFile = {
    $schema: JOB_SCHEMA_URL,
    kind: 'snugclip.job',
    version: 1,
    target: { ...target },
    options: { ...DEFAULT_OPTIONS, ...options },
  };
  if (extra.inputs) job.inputs = [...extra.inputs];
  if (extra.note) job.note = extra.note;
  return job;
}

/** Serialises a job with a stable key order and 2-space indent, ending in a newline. */
export function serializeJob(job: JobFile): string {
  const t: Record<string, Json> = { bytes: job.target.bytes };
  if (job.target.presetId) t.presetId = job.target.presetId;
  if (job.target.label) t.label = job.target.label;
  const o = job.options;
  const out: Record<string, Json> = {
    $schema: JOB_SCHEMA_URL,
    kind: 'snugclip.job',
    version: 1,
    target: t,
    options: {
      codec: o.codec,
      maxHeight: o.maxHeight,
      fps: o.fps,
      trim: o.trim ? { start: o.trim.start, end: o.trim.end } : null,
      mute: o.mute,
      reencode: o.reencode,
    },
  };
  if (job.inputs) out.inputs = job.inputs;
  if (job.note) out.note = job.note;
  if (job.reports) out.reports = job.reports as unknown as Json;
  return JSON.stringify(out, null, 2) + '\n';
}

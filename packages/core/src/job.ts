// Job files (`*.snugclip.json`, schema v1) and settings deep links (PLAN §6).
import { z } from 'zod';
import { SnugclipError } from './errors.js';
import { normalizeOptions } from './plan.js';
import { getPreset, resolveTarget } from './presets.js';
import { JobSchema, OptionsSchema } from './schemas.js';
import { JOB_SCHEMA_URL } from './site.js';
import { parseSize } from './size.js';
import type { CodecChoice, Options, Report, Target } from './types.js';

export type JobTarget = { preset: string } | { bytes: number } | { size: string };
export type JobOptions = Partial<Pick<Options, 'codec' | 'maxShortSide' | 'fpsCap' | 'keepFps' | 'mute' | 'trim' | 'reencode'>>;

export interface Job {
  $schema?: string;
  snugclip: 'job';
  version: 1;
  target: JobTarget;
  options?: JobOptions;
  /** CLI/MCP only (globs allowed); ignored by the web app. */
  inputs?: string[];
  /** CLI only. `pattern` tokens: {name} {size} {ext}. */
  output?: { dir?: string; pattern?: string };
  reports?: Report[];
  /** Unknown top-level keys, preserved on re-export. */
  [extra: string]: unknown;
}

const KNOWN = ['$schema', 'snugclip', 'version', 'target', 'options', 'inputs', 'output', 'reports'] as const;

/** Parses and validates a job (JSON text or an object). Throws E_JOB / E_JOB_VERSION / E_PRESET / E_TRIM. */
export function parseJob(json: unknown): Job {
  return parseJobWithWarnings(json).job;
}

export function parseJobWithWarnings(json: unknown): { job: Job; warnings: string[] } {
  let value = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch (e) {
      throw new SnugclipError('E_JOB', `Job file is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SnugclipError('E_JOB', 'A job file must be a JSON object.');
  const v = value as Record<string, unknown>;
  if (v.snugclip !== 'job') throw new SnugclipError('E_JOB', 'Not a Snugclip job file (expected "snugclip": "job").');
  if (v.version === undefined) throw new SnugclipError('E_JOB', 'Job file has no "version"; this Snugclip reads version 1.');
  if (v.version !== 1) throw new SnugclipError('E_JOB_VERSION', `This job file is version ${String(v.version)}; this Snugclip reads version 1.`);
  const r = JobSchema.safeParse(v);
  if (!r.success) throw new SnugclipError('E_JOB', `Invalid job file: ${z.prettifyError(r.error).replace(/\n/g, '; ')}`);
  const job = r.data as Job;
  if ('preset' in job.target && !getPreset(job.target.preset)) {
    throw new SnugclipError('E_PRESET', `Unknown preset "${job.target.preset}".`, { hint: 'Run `snugclip presets` to list them.' });
  }
  if ('size' in job.target) parseSize(job.target.size);
  const t = job.options?.trim;
  if (t && !(t.endSec > t.startSec)) throw new SnugclipError('E_TRIM', `Trim end (${t.endSec}) must be after trim start (${t.startSec}).`);
  const warnings = Object.keys(v)
    .filter((k) => !(KNOWN as readonly string[]).includes(k))
    .map((k) => `Unknown field "${k}" kept as is.`);
  return { job, warnings };
}

/** Resolves a job's target to bytes. */
export function jobTarget(job: Pick<Job, 'target'>): Target {
  const t = job.target;
  if ('bytes' in t) return resolveTarget({ bytes: t.bytes });
  if ('size' in t) return resolveTarget({ size: t.size });
  return resolveTarget({ preset: t.preset });
}

/** Job options → full Options (nulls dropped, defaults filled). */
export function jobOptions(job: Pick<Job, 'options'>): Options {
  const o = job.options ?? {};
  const clean: Partial<Options> = {};
  for (const [k, val] of Object.entries(o)) if (val !== null && val !== undefined) (clean as Record<string, unknown>)[k] = val;
  return normalizeOptions(clean);
}

/** Builds a job from a resolved target and options (for "Export setup"). */
export function createJob(target: Target, options: Partial<Options> = {}, extra: Pick<Job, 'inputs' | 'output' | 'reports'> = {}): Job {
  const jt: JobTarget = target.presetId && getPreset(target.presetId)?.bytes === target.bytes ? { preset: target.presetId } : { bytes: target.bytes };
  const o: JobOptions = {};
  if (options.codec && options.codec !== 'compatible') o.codec = options.codec;
  if (options.maxShortSide !== undefined) o.maxShortSide = options.maxShortSide;
  if (options.fpsCap !== undefined) o.fpsCap = options.fpsCap;
  if (options.keepFps) o.keepFps = true;
  if (options.mute) o.mute = true;
  if (options.trim) o.trim = { startSec: options.trim.startSec, endSec: options.trim.endSec };
  if (options.reencode) o.reencode = true;
  const job: Job = { $schema: JOB_SCHEMA_URL, snugclip: 'job', version: 1, target: jt };
  if (Object.keys(o).length) job.options = o;
  if (extra.inputs) job.inputs = [...extra.inputs];
  if (extra.output) job.output = { ...extra.output };
  if (extra.reports) job.reports = [...extra.reports];
  return job;
}

const OPTION_ORDER = ['codec', 'maxShortSide', 'fpsCap', 'keepFps', 'mute', 'trim', 'reencode'] as const;

/** Canonical JSON: fixed key order, 2-space indent, trailing newline; unknown keys kept at the end. */
export function serializeJob(job: Job): string {
  const out: Record<string, unknown> = {};
  if (job.$schema !== undefined) out.$schema = job.$schema;
  out.snugclip = 'job';
  out.version = 1;
  const t = job.target;
  out.target = 'preset' in t ? { preset: t.preset } : 'bytes' in t ? { bytes: t.bytes } : { size: t.size };
  if (job.options) {
    const o: Record<string, unknown> = {};
    for (const k of OPTION_ORDER) {
      const val = job.options[k];
      if (val === undefined) continue;
      o[k] = k === 'trim' && val ? { startSec: (val as { startSec: number }).startSec, endSec: (val as { endSec: number }).endSec } : val;
    }
    out.options = o;
  }
  if (job.inputs) out.inputs = job.inputs;
  if (job.output) {
    const o: Record<string, unknown> = {};
    if (job.output.dir !== undefined) o.dir = job.output.dir;
    if (job.output.pattern !== undefined) o.pattern = job.output.pattern;
    out.output = o;
  }
  if (job.reports) out.reports = job.reports;
  for (const k of Object.keys(job)) if (!(KNOWN as readonly string[]).includes(k)) out[k] = job[k];
  return JSON.stringify(out, null, 2) + '\n';
}

// ---- Deep links ------------------------------------------------------------------------------

const truthy = (s: string) => s === '1' || s === 'true' || s === 'yes' || s === '';

/** "?a=1&b=2" (or a full URL) → { a: "1", b: "2" }. No URLSearchParams, so it runs anywhere. */
export function queryToRecord(search: string): Record<string, string> {
  const q = search.replace(/^[^?]*\?/, '').replace(/#.*$/, '');
  const out: Record<string, string> = {};
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        return s;
      }
    };
    out[dec(i === -1 ? pair : pair.slice(0, i))] = i === -1 ? '' : dec(pair.slice(i + 1));
  }
  return out;
}

/**
 * Deep-link params → partial job. Recognised: preset, size (overrides preset), codec, maxh, fps,
 * keepfps, mute, start, end, reencode. Invalid values are dropped and reported in `notices`.
 */
export function jobFromQueryWithNotices(q: Record<string, string>): { job: Partial<Job>; notices: string[] } {
  const notices: string[] = [];
  const job: Partial<Job> = {};
  const o: JobOptions = {};
  const get = (k: string) => (Object.prototype.hasOwnProperty.call(q, k) ? q[k] : undefined);
  const preset = get('preset');
  if (preset !== undefined) {
    const p = getPreset(preset);
    if (p) job.target = { preset: p.id };
    else notices.push(`Unknown preset "${preset}" ignored.`);
  }
  const size = get('size');
  if (size !== undefined) {
    try {
      parseSize(size);
      job.target = { size: size.replace(/\s+/g, '') };
    } catch {
      notices.push(`Size "${size}" ignored.`);
    }
  }
  const codec = get('codec');
  if (codec !== undefined) {
    const r = OptionsSchema.shape.codec.safeParse(codec.toLowerCase());
    if (r.success && r.data) o.codec = r.data as CodecChoice;
    else notices.push(`Codec "${codec}" ignored.`);
  }
  const num = (k: string, ok: (n: number) => boolean, set: (n: number) => void) => {
    const s = get(k);
    if (s === undefined) return;
    const n = Number(s);
    if (s.trim() !== '' && Number.isFinite(n) && ok(n)) set(n);
    else notices.push(`${k}="${s}" ignored.`);
  };
  num('maxh', (n) => Number.isInteger(n) && n >= 64 && n <= 8640, (n) => (o.maxShortSide = n));
  num('fps', (n) => n > 0 && n <= 240, (n) => (o.fpsCap = n));
  let start: number | undefined;
  let end: number | undefined;
  num('start', (n) => n >= 0, (n) => (start = n));
  num('end', (n) => n > 0, (n) => (end = n));
  if (start !== undefined || end !== undefined) {
    const s0 = start ?? 0;
    const e0 = end ?? Number.MAX_SAFE_INTEGER;
    if (e0 > s0) o.trim = { startSec: s0, endSec: e0 };
    else notices.push('Trim ignored: end must be after start.');
  }
  for (const [k, key] of [
    ['keepfps', 'keepFps'],
    ['mute', 'mute'],
    ['reencode', 'reencode'],
  ] as const) {
    const s = get(k);
    if (s !== undefined && truthy(s.toLowerCase())) o[key] = true;
  }
  if (Object.keys(o).length) job.options = o;
  return { job, notices };
}

export function jobFromQuery(q: Record<string, string>): Partial<Job> {
  return jobFromQueryWithNotices(q).job;
}

const fmtNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** Partial job → canonical query string without the leading "?" ("" when all defaults). Never carries file names. */
export function jobToQuery(job: Partial<Job>): string {
  const parts: string[] = [];
  const t = job.target;
  if (t) {
    if ('preset' in t) parts.push(`preset=${encodeURIComponent(t.preset)}`);
    else if ('size' in t) parts.push(`size=${encodeURIComponent(t.size)}`);
    else parts.push(`size=${t.bytes}B`);
  }
  const o = job.options ?? {};
  if (o.codec && o.codec !== 'compatible') parts.push(`codec=${o.codec}`);
  if (o.maxShortSide != null) parts.push(`maxh=${o.maxShortSide}`);
  if (o.fpsCap != null) parts.push(`fps=${fmtNum(o.fpsCap)}`);
  if (o.keepFps) parts.push('keepfps=1');
  if (o.mute) parts.push('mute=1');
  if (o.trim) {
    if (o.trim.startSec > 0) parts.push(`start=${fmtNum(o.trim.startSec)}`);
    if (o.trim.endSec < Number.MAX_SAFE_INTEGER) parts.push(`end=${fmtNum(o.trim.endSec)}`);
  }
  if (o.reencode) parts.push('reencode=1');
  return parts.join('&');
}

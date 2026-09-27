// Node-side batch runner shared by the CLI and the MCP server: input expansion (dirs, globs),
// output naming, the no-overwrite rule, and report paths. Uses the core's runFit for the fit.
import { globSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  SnugclipError,
  isSnugclipError,
  normalizeOptions,
  plan as makePlan,
  runFit,
  sizeTag,
  TUNING,
  type AbortSignalLike,
  type FitProgress,
  type Options,
  type Plan,
  type Probe,
  type Report,
  type Target,
} from '@snugclip/core';
import { FfmpegEngine, type FfmpegEngineOptions } from './engine.js';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv'];

export interface RunnerOptions extends Pick<FfmpegEngineOptions, 'ffmpegPath' | 'ffprobePath' | 'env' | 'threads' | 'forceEncoder'> {
  /** Base for relative paths (default process.cwd()). */
  cwd?: string;
  /** Exact output file (single input only). */
  output?: string;
  outDir?: string;
  /** Output name pattern; tokens {name} {size} {ext}. Default "{name}-snug-{size}.{ext}". */
  pattern?: string;
  overwrite?: boolean;
  /** Clock (ms). `fixedClock` (ISO) pins createdAt and zeroes elapsedMs for golden tests. */
  now?: () => number;
  fixedClock?: string;
  signal?: AbortSignalLike;
  onProgress?: (input: string, p: FitProgress) => void;
  onItemStart?: (input: string, index: number, total: number) => void;
  onItemDone?: (report: Report, index: number, total: number) => void;
  stallMs?: number;
  /** Reuse an engine (tests); otherwise one is created per call. */
  engine?: FfmpegEngine;
}

export interface PlanResult {
  input: string;
  probe: Probe | null;
  plan: Plan | null;
  error?: { code: string; message: string; hint?: string };
}
export interface ProbeResult {
  input: string;
  probe: Probe | null;
  error?: { code: string; message: string; hint?: string };
}

const errorOf = (e: unknown) =>
  isSnugclipError(e) ? { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } : { code: 'E_INTERNAL', message: (e as Error)?.message ?? String(e) };

/** Expands directories (non-recursive, video extensions only) and glob patterns; keeps order, drops duplicates. */
export function expandInputs(inputs: string[], cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const key = resolve(cwd, p);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  };
  for (const raw of inputs) {
    const abs = resolve(cwd, raw);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs).sort()) {
        if (VIDEO_EXTENSIONS.includes(extname(f).slice(1).toLowerCase()) && statSync(join(abs, f)).isFile()) add(join(raw, f));
      }
    } else if (/[*?[]/.test(raw) && !existsSync(abs)) {
      const matches = globSync(raw, { cwd }).sort();
      if (!matches.length) add(raw); // reported as missing later
      for (const m of matches) add(m);
    } else add(raw);
  }
  return out;
}

/** Final output path for an input. */
export function outputPathFor(input: string, target: Target, ext: string, ro: Pick<RunnerOptions, 'output' | 'outDir' | 'pattern' | 'cwd'>): string {
  const cwd = ro.cwd ?? process.cwd();
  if (ro.output) return resolve(cwd, ro.output);
  const stem = basename(input, extname(input));
  const name = (ro.pattern ?? '{name}-snug-{size}.{ext}').replaceAll('{name}', stem).replaceAll('{size}', sizeTag(target.bytes)).replaceAll('{ext}', ext);
  return resolve(cwd, ro.outDir ?? dirname(resolve(cwd, input)), name);
}

function makeEngine(ro: RunnerOptions, target: Target): FfmpegEngine {
  if (ro.engine) return ro.engine;
  const opts: FfmpegEngineOptions = {
    overwrite: !!ro.overwrite,
    outputFor: (input, ext) => outputPathFor(input, target, ext, ro),
  };
  if (ro.ffmpegPath) opts.ffmpegPath = ro.ffmpegPath;
  if (ro.ffprobePath) opts.ffprobePath = ro.ffprobePath;
  if (ro.env) opts.env = ro.env;
  if (ro.threads) opts.threads = ro.threads;
  if (ro.forceEncoder) opts.forceEncoder = ro.forceEncoder;
  return new FfmpegEngine(opts);
}

function clock(ro: RunnerOptions): () => number {
  if (ro.fixedClock) {
    const t = Date.parse(ro.fixedClock);
    if (Number.isNaN(t)) throw new SnugclipError('E_ARGS', `SNUGCLIP_FIXED_CLOCK "${ro.fixedClock}" is not an ISO date.`);
    return () => t;
  }
  return ro.now ?? Date.now;
}

const neverAborted: AbortSignalLike = { aborted: false, addEventListener() {}, removeEventListener() {} };

function failedReport(input: string, target: Target, now: () => number, e: unknown, engineVersion = ''): Report {
  const err = errorOf(e);
  return {
    snugclip: 'report',
    version: 1,
    createdAt: new Date(now()).toISOString(),
    status: /^E_UNSUPPORTED/.test(err.code) ? 'unsupported' : 'error',
    fits: false,
    passThrough: false,
    input: { name: basename(input), path: input, bytes: existsSync(input) ? statSync(input).size : 0, probe: null },
    target,
    output: null,
    plan: null,
    attempts: [],
    quality: null,
    warnings: [],
    error: err,
    engine: { id: 'ffmpeg', version: engineVersion, encoder: '' },
    elapsedMs: 0,
  };
}

/**
 * Compresses each input to `target`. Throws only for fatal problems before any item
 * (E_FFMPEG_MISSING, E_ARGS); per-item problems go in each report's `error`.
 */
export async function compressFiles(inputs: string[], target: Target, options: Partial<Options>, ro: RunnerOptions = {}): Promise<Report[]> {
  const cwd = ro.cwd ?? process.cwd();
  if (ro.output && inputs.length > 1) throw new SnugclipError('E_ARGS', '-o/--output works with a single input; use --out-dir for batches.');
  normalizeOptions(options);
  const now = clock(ro);
  const engine = makeEngine(ro, target);
  const caps = await engine.capabilities(); // fatal E_FFMPEG_MISSING surfaces here, before any item
  const reports: Report[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const abs = resolve(cwd, input);
    ro.onItemStart?.(input, i, inputs.length);
    if (ro.signal?.aborted) {
      const r = failedReport(input, target, now, new SnugclipError('E_CANCELLED', 'Cancelled.'), caps.version);
      r.status = 'cancelled';
      reports.push(r);
      ro.onItemDone?.(r, i, inputs.length);
      continue;
    }
    let report: Report;
    try {
      if (!existsSync(abs)) throw new SnugclipError('E_IO', `${input} doesn't exist.`);
      const probe = await engine.probe(abs);
      // Know the final path before spending time encoding, so an existing file fails fast.
      const p = makePlan(probe, target, options, caps);
      if (p.feasible) {
        const ext = p.passThrough ? extname(abs).slice(1) || 'mp4' : p.container;
        const finalPath = outputPathFor(abs, target, ext, ro);
        if (resolve(finalPath) === abs) throw new SnugclipError('E_EXISTS', `The output would overwrite the input (${input}).`, { hint: 'Choose another -o/--out-dir.' });
        if (existsSync(finalPath) && !ro.overwrite) throw new SnugclipError('E_EXISTS', `${finalPath} already exists.`, { hint: 'Pass --overwrite to replace it, or choose another -o/--out-dir.' });
        mkdirSync(dirname(finalPath), { recursive: true });
      }
      const fit = await runFit(engine, abs, target, options, {
        now,
        signal: ro.signal ?? neverAborted,
        inputName: basename(input),
        inputPath: input,
        probe,
        stallMs: ro.stallMs ?? TUNING.stallMs.ffmpeg,
        timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
        ...(ro.onProgress ? { onProgress: (pr: FitProgress) => ro.onProgress!(input, pr) } : {}),
      });
      const { outputRef, ...rest } = fit;
      report = rest;
      if (report.output && outputRef) {
        report.output.path = outputRef.path;
        report.output.name = basename(outputRef.path);
      }
      report.warnings.push(...engine.warningsFor(probe));
    } catch (e) {
      report = failedReport(input, target, now, e, caps.version);
    }
    if (ro.fixedClock) report.elapsedMs = 0;
    reports.push(report);
    ro.onItemDone?.(report, i, inputs.length);
  }
  await engine.cleanup();
  return reports;
}

/** Dry run: probe + plan, no encode. */
export async function planFiles(inputs: string[], target: Target, options: Partial<Options>, ro: RunnerOptions = {}): Promise<PlanResult[]> {
  const cwd = ro.cwd ?? process.cwd();
  normalizeOptions(options);
  const engine = makeEngine(ro, target);
  const caps = await engine.capabilities();
  const out: PlanResult[] = [];
  for (const input of inputs) {
    try {
      const abs = resolve(cwd, input);
      if (!existsSync(abs)) throw new SnugclipError('E_IO', `${input} doesn't exist.`);
      const probe = await engine.probe(abs);
      try {
        const p = makePlan(probe, target, options, caps);
        p.warnings.push(...engine.warningsFor(probe));
        out.push({ input, probe, plan: p });
      } catch (e) {
        out.push({ input, probe, plan: null, error: errorOf(e) });
      }
    } catch (e) {
      out.push({ input, probe: null, plan: null, error: errorOf(e) });
    }
  }
  return out;
}

export async function probeFiles(inputs: string[], ro: RunnerOptions = {}): Promise<ProbeResult[]> {
  const cwd = ro.cwd ?? process.cwd();
  const engine = ro.engine ?? makeEngine(ro, { bytes: 1, label: '' });
  engine.ffmpeg();
  const out: ProbeResult[] = [];
  for (const input of inputs) {
    try {
      const abs = resolve(cwd, input);
      if (!existsSync(abs)) throw new SnugclipError('E_IO', `${input} doesn't exist.`);
      out.push({ input, probe: await engine.probe(abs) });
    } catch (e) {
      out.push({ input, probe: null, error: errorOf(e) });
    }
  }
  return out;
}

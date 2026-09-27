// `snugclip` CLI (PLAN §7.1). `main()` is pure over its Io, so tests run it in-process.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  CORE_VERSION,
  PRESETS,
  SUPPORT_URL,
  SnugclipError,
  combineExitCodes,
  createJob,
  exitCodeFor,
  isSnugclipError,
  jobOptions,
  jobTarget,
  parseJob,
  resolveTarget,
  serializeJob,
  type Job,
  type Options,
  type Report,
  type Target,
} from '@snugclip/core';
import { compressFiles, expandInputs, killAllChildren, planFiles, probeFiles, type RunnerOptions } from '@snugclip/engine-ffmpeg';
import { HELP, optionsFromFlags, parseCli, type ParsedArgs } from './args.js';
import { planLines, presetLines, probeLine, progressLine, reportLine, warningLines } from './format.js';

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** stderr is a terminal (enables the live progress line). */
  isTTY: boolean;
  /** Registers SIGINT/SIGTERM handling; returns an unregister function. */
  onSignal?: (handler: () => void) => () => void;
}

export function nodeIo(): Io {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    env: process.env,
    cwd: process.cwd(),
    isTTY: !!process.stderr.isTTY,
    onSignal: (handler) => {
      const h = () => handler();
      process.on('SIGINT', h);
      process.on('SIGTERM', h);
      return () => {
        process.off('SIGINT', h);
        process.off('SIGTERM', h);
      };
    },
  };
}

export const SUPPORT_LINE = `Snugclip is free. If it saved you time: ${SUPPORT_URL}`;

type Cmd = 'compress' | 'plan' | 'probe' | 'presets';

function json(io: Io, doc: unknown) {
  io.stdout(JSON.stringify(doc, null, 2) + '\n');
}

function fatal(io: Io, cmd: Cmd | null, jsonMode: boolean, e: unknown): number {
  const err = isSnugclipError(e) ? e.toJSON() : { code: 'E_INTERNAL', message: (e as Error)?.message ?? String(e) };
  if (jsonMode) json(io, { snugclip: cmd ?? 'compress', version: 1, error: err });
  else io.stderr(`snugclip: ${err.message}${'hint' in err && err.hint ? `\n  ${err.hint}` : ''}\n`);
  return exitCodeFor(err.code);
}

interface Resolved {
  target: Target | null;
  options: Partial<Options>;
  inputs: string[];
  job: Job | null;
  jobDir: string;
}

function resolveInputsAndTarget(a: ParsedArgs, io: Io, needTarget: boolean): Resolved {
  let job: Job | null = null;
  let jobDir = io.cwd;
  if (a.values.job) {
    const path = resolve(io.cwd, a.values.job);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (e) {
      throw new SnugclipError('E_IO', `Can't read job file ${a.values.job}: ${(e as Error).message}`);
    }
    job = parseJob(text);
    jobDir = dirname(path);
  }
  let target: Target | null = null;
  if (a.values.size !== undefined || a.values.preset !== undefined) {
    const t: { size?: string; preset?: string } = {};
    if (a.values.size !== undefined) t.size = a.values.size;
    if (a.values.preset !== undefined) t.preset = a.values.preset;
    target = resolveTarget(t);
  } else if (job) target = jobTarget(job);
  if (needTarget && !target) throw new SnugclipError('E_ARGS', 'Give a target: --size 10MB or --preset discord.', { hint: 'Run `snugclip presets` to list presets.' });
  const flagOpts = optionsFromFlags(a.values);
  const options: Partial<Options> = job ? { ...jobOptions(job), ...flagOpts } : flagOpts;
  let inputs = a.inputs;
  if (!inputs.length && job?.inputs?.length) inputs = job.inputs.map((p) => (isAbsolute(p) ? p : join(jobDir, p)));
  return { target, options, inputs: expandInputs(inputs, io.cwd), job, jobDir };
}

function runnerOptions(a: ParsedArgs, io: Io, job: Job | null, jobDir: string): RunnerOptions {
  const ro: RunnerOptions = { cwd: io.cwd, env: io.env, overwrite: !!a.values.overwrite };
  if (a.values.ffmpeg) ro.ffmpegPath = a.values.ffmpeg;
  if (a.values.ffprobe) ro.ffprobePath = a.values.ffprobe;
  if (a.values.output) ro.output = a.values.output;
  const outDir = a.values['out-dir'] ?? (job?.output?.dir ? resolve(jobDir, job.output.dir) : undefined);
  if (outDir) ro.outDir = outDir;
  if (job?.output?.pattern) ro.pattern = job.output.pattern;
  if (io.env.SNUGCLIP_FIXED_CLOCK) ro.fixedClock = io.env.SNUGCLIP_FIXED_CLOCK;
  if (io.env.SNUGCLIP_FORCE_ENCODER) ro.forceEncoder = io.env.SNUGCLIP_FORCE_ENCODER;
  return ro;
}

const reportExit = (r: Report) =>
  r.status === 'fit' || r.status === 'passthrough' ? 0 : r.status === 'cancelled' ? 1 : exitCodeFor(r.error?.code ?? (r.status === 'impossible' ? 'E_IMPOSSIBLE' : 'E_INTERNAL'));

export async function main(argv: string[], io: Io): Promise<number> {
  const jsonMode = argv.includes('--json');
  let cmd: Cmd | null = null;
  try {
    const a = parseCli(argv);
    if (a.values.version) {
      io.stdout(`snugclip ${CORE_VERSION}\n`);
      return 0;
    }
    if (a.values.help || a.command === 'help' || a.command === null) {
      if (a.command === null && !a.values.help && argv.length) throw new SnugclipError('E_ARGS', 'Missing command.', { hint: 'Run `snugclip --help`.' });
      io.stdout(HELP);
      return 0;
    }
    if (a.command === 'mcp') {
      const { startStdioServer } = await import('@snugclip/mcp');
      await startStdioServer();
      return 0;
    }
    cmd = a.command;
    const quiet = !!a.values.quiet || jsonMode;

    if (cmd === 'presets') {
      if (jsonMode) json(io, { snugclip: 'presets', version: 1, results: PRESETS });
      else io.stdout(presetLines(PRESETS).join('\n') + '\n');
      return 0;
    }

    if (cmd === 'probe') {
      if (!a.inputs.length) throw new SnugclipError('E_ARGS', 'Give at least one input file.');
      const results = await probeFiles(expandInputs(a.inputs, io.cwd), runnerOptions(a, io, null, io.cwd));
      if (jsonMode) json(io, { snugclip: 'probe', version: 1, results });
      else io.stdout(results.map(probeLine).join('\n') + '\n');
      return combineExitCodes(results.map((r) => exitCodeFor(r.error?.code)));
    }

    const { target, options, inputs, job, jobDir } = resolveInputsAndTarget(a, io, true);
    if (!inputs.length) throw new SnugclipError('E_ARGS', 'Give at least one input file (or a job file with "inputs").');
    const ro = runnerOptions(a, io, job, jobDir);

    if (cmd === 'plan') {
      const results = await planFiles(inputs, target!, options, ro);
      if (jsonMode) json(io, { snugclip: 'plan', version: 1, results });
      else io.stdout(results.flatMap(planLines).join('\n') + '\n');
      return combineExitCodes(results.map((r) => (r.error ? exitCodeFor(r.error.code) : r.plan && !r.plan.feasible ? 2 : 0)));
    }

    // compress
    const ac = new AbortController();
    let interrupted = false;
    const off = io.onSignal?.(() => {
      if (interrupted) {
        killAllChildren();
        return;
      }
      interrupted = true;
      io.stderr('\nsnugclip: stopping, cleaning up temp files…\n');
      ac.abort();
    });
    let lastLine = '';
    const clearLine = () => {
      if (lastLine) io.stderr('\r' + ' '.repeat(lastLine.length) + '\r');
      lastLine = '';
    };
    ro.signal = ac.signal;
    if (!quiet && io.isTTY) {
      ro.onProgress = (input, p) => {
        const line = progressLine(input, p);
        if (line !== lastLine) {
          io.stderr('\r' + line.padEnd(lastLine.length));
          lastLine = line;
        }
      };
    }
    ro.onItemDone = (r) => {
      clearLine();
      if (!jsonMode) {
        io.stdout(reportLine(r) + '\n');
        const w = warningLines(r);
        if (w.length && !a.values.quiet) io.stderr(w.join('\n') + '\n');
      }
    };
    let reports: Report[];
    try {
      reports = await compressFiles(inputs, target!, options, ro);
    } finally {
      off?.();
      clearLine();
    }
    if (a.values['save-job']) {
      const base = job ?? createJob(target!, options, { inputs: a.inputs });
      const out: Job = { ...base, reports };
      writeFileSync(resolve(io.cwd, a.values['save-job']), serializeJob(out));
    }
    if (jsonMode) json(io, { snugclip: 'compress', version: 1, results: reports });
    const code = interrupted ? 1 : combineExitCodes(reports.map(reportExit));
    const anyOk = reports.some((r) => r.status === 'fit' || r.status === 'passthrough');
    if (anyOk && !jsonMode && !a.values['no-support'] && !io.env.SNUGCLIP_NO_SUPPORT) io.stderr(SUPPORT_LINE + '\n');
    return code;
  } catch (e) {
    return fatal(io, cmd, jsonMode, e);
  }
}

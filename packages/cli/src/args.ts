// Argument parsing (node:util parseArgs, no dependency) and flag → options mapping (PLAN §7.1).
import { parseArgs } from 'node:util';
import { SnugclipError, type CodecChoice, type Options } from '@snugclip/core';

export const COMMANDS = ['compress', 'plan', 'probe', 'presets', 'mcp', 'help'] as const;
export type Command = (typeof COMMANDS)[number];

const OPTIONS = {
  size: { type: 'string' },
  preset: { type: 'string' },
  codec: { type: 'string' },
  'max-height': { type: 'string' },
  fps: { type: 'string' },
  'keep-fps': { type: 'boolean' },
  mute: { type: 'boolean' },
  start: { type: 'string' },
  end: { type: 'string' },
  'trim-start': { type: 'string' },
  'trim-end': { type: 'string' },
  reencode: { type: 'boolean' },
  attempts: { type: 'string' },
  output: { type: 'string', short: 'o' },
  'out-dir': { type: 'string' },
  overwrite: { type: 'boolean' },
  job: { type: 'string' },
  'save-job': { type: 'string' },
  ffmpeg: { type: 'string' },
  ffprobe: { type: 'string' },
  'no-support': { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

export interface ParsedArgs {
  command: Command | null;
  inputs: string[];
  values: {
    size?: string;
    preset?: string;
    codec?: string;
    'max-height'?: string;
    fps?: string;
    'keep-fps'?: boolean;
    mute?: boolean;
    start?: string;
    end?: string;
    'trim-start'?: string;
    'trim-end'?: string;
    reencode?: boolean;
    attempts?: string;
    output?: string;
    'out-dir'?: string;
    overwrite?: boolean;
    job?: string;
    'save-job'?: string;
    ffmpeg?: string;
    ffprobe?: string;
    'no-support'?: boolean;
    quiet?: boolean;
    json?: boolean;
    help?: boolean;
    version?: boolean;
  };
}

export function parseCli(argv: string[]): ParsedArgs {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    throw new SnugclipError('E_ARGS', (e as Error).message.replace(/^.*?: /, ''), { hint: 'Run `snugclip --help` for usage.' });
  }
  const [first, ...rest] = parsed.positionals;
  let command: Command | null = null;
  let inputs = parsed.positionals;
  if (first !== undefined) {
    if (!(COMMANDS as readonly string[]).includes(first)) {
      throw new SnugclipError('E_ARGS', `Unknown command "${first}".`, { hint: 'Commands: compress, plan, probe, presets, mcp. Run `snugclip --help`.' });
    }
    command = first as Command;
    inputs = rest;
  }
  return { command, inputs, values: parsed.values as ParsedArgs['values'] };
}

/** "12", "12.5", "1:05", "01:02:03.5" → seconds. */
export function parseTime(v: string, flag: string): number {
  const parts = v.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) {
    throw new SnugclipError('E_ARGS', `--${flag} "${v}" isn't a time. Use seconds (12.5) or hh:mm:ss.ms (0:01:05.5).`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

const CODECS: CodecChoice[] = ['compatible', 'smaller', 'h264', 'hevc', 'av1', 'vp9'];

/** Flag values → partial core Options (only the flags that were given). */
export function optionsFromFlags(v: ParsedArgs['values']): Partial<Options> {
  const o: Partial<Options> = {};
  if (v.codec !== undefined) {
    const c = v.codec.toLowerCase().replace(/^h\.?265$/, 'hevc').replace(/^h\.?264$|^avc$/, 'h264') as CodecChoice;
    if (!CODECS.includes(c)) throw new SnugclipError('E_ARGS', `Unknown codec "${v.codec}". Use one of: ${CODECS.join(', ')}.`);
    o.codec = c;
  }
  if (v['max-height'] !== undefined) {
    const n = Number(v['max-height'].replace(/p$/i, ''));
    if (!Number.isInteger(n) || n < 64) throw new SnugclipError('E_ARGS', `--max-height must be a whole number of pixels ≥ 64 (got "${v['max-height']}").`);
    o.maxShortSide = n;
  }
  if (v.fps !== undefined) {
    const n = Number(v.fps);
    if (!(n > 0 && n <= 240)) throw new SnugclipError('E_ARGS', `--fps must be a number from 1 to 240 (got "${v.fps}").`);
    o.fpsCap = n;
  }
  if (v['keep-fps']) o.keepFps = true;
  if (v.mute) o.mute = true;
  if (v.reencode) o.reencode = true;
  const start = v.start ?? v['trim-start'];
  const end = v.end ?? v['trim-end'];
  if (start !== undefined || end !== undefined) {
    const s = start !== undefined ? parseTime(start, 'start') : 0;
    const e = end !== undefined ? parseTime(end, 'end') : Number.MAX_SAFE_INTEGER;
    if (!(e > s)) throw new SnugclipError('E_TRIM', `--end (${e}) must be after --start (${s}).`);
    o.trim = { startSec: s, endSec: e };
  }
  if (v.attempts !== undefined) {
    const n = Number(v.attempts);
    if (!Number.isInteger(n) || n < 1 || n > 8) throw new SnugclipError('E_ARGS', `--attempts must be 1–8 (got "${v.attempts}").`);
    o.maxAttempts = n;
  }
  return o;
}

export const HELP = `snugclip: fit any video under an exact size limit. Never outputs a file over it.

Usage
  snugclip compress <input...> (--size 10MB | --preset discord) [options] [--json]
  snugclip plan     <input...> (--size | --preset) [options] [--json]   dry run, no encode
  snugclip probe    <input...> [--json]
  snugclip presets  [--json]
  snugclip mcp                                                           stdio MCP server

Target
  --size <n>            10MB, 9.5MiB, 800KB (decimal MB: 1 MB = 1,000,000 bytes)
  --preset <id>         discord, discord-nitro-basic, whatsapp, gmail, outlook, email, … (see \`snugclip presets\`)

Options
  --codec <c>           compatible (H.264 MP4, default) | smaller (AV1, else HEVC) | h264 | hevc | av1 | vp9
  --max-height <px>     cap the short side, e.g. 720 (never upscales)
  --fps <n>             cap the frame rate          --keep-fps   never drop frames
  --start <t> --end <t> trim (seconds or hh:mm:ss.ms; aliases --trim-start/--trim-end)
  --mute                drop audio                  --reencode   re-encode even if already small
  --attempts <1-8>      encode attempts before giving up
  -o, --output <file>   output file (single input)  --out-dir <dir>   output folder
  --overwrite           replace existing outputs    --job <file> / --save-job <file>   job files
  --ffmpeg <path> --ffprobe <path>                  use these binaries
  --json                one JSON document on stdout --quiet  no progress   --no-support  no support line

Exit codes: 0 fits (or already small), 2 target impossible (minimumBytes in JSON),
            3 unsupported input, 4 ffmpeg/ffprobe missing, 1 anything else.
`;

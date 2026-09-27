// Shared parsing of user-supplied targets and options (CLI flags, MCP arguments, job files,
// deep links) so every surface accepts exactly the same spellings.
import { MAX_TARGET_BYTES } from './constants.js';
import { SnugclipError } from './errors.js';
import { getPreset, presetTarget } from './presets.js';
import type { CodecChoice, FpsPolicy, Target, TrimRange } from './types.js';
import { formatTarget, parseSize } from './units.js';

export const CODEC_CHOICES: readonly CodecChoice[] = ['compatible', 'smaller', 'h264', 'hevc', 'av1', 'vp9'];

export function parseCodec(v: string): CodecChoice {
  const s = v.trim().toLowerCase();
  const alias: Record<string, CodecChoice> = { avc: 'h264', 'h.264': 'h264', x264: 'h264', h265: 'hevc', 'h.265': 'hevc', x265: 'hevc', webm: 'vp9' };
  const c = (alias[s] ?? s) as CodecChoice;
  if (!CODEC_CHOICES.includes(c)) {
    throw new SnugclipError('INVALID_ARGUMENT', `Unknown codec "${v}". Use one of: ${CODEC_CHOICES.join(', ')}.`);
  }
  return c;
}

export function parseFps(v: string | number): FpsPolicy {
  if (typeof v === 'number') {
    if (!(v > 0 && v <= 240)) throw new SnugclipError('INVALID_ARGUMENT', `fps must be between 1 and 240 (got ${v}).`);
    return v;
  }
  const s = v.trim().toLowerCase();
  if (s === 'auto' || s === 'keep') return s;
  const n = Number(s);
  if (!(n > 0 && n <= 240)) throw new SnugclipError('INVALID_ARGUMENT', `fps must be auto, keep, or a number between 1 and 240 (got "${v}").`);
  return n;
}

/** Parses a time like `12`, `12.5`, `1:05`, `1:02:03.5` into seconds. */
export function parseTime(v: string | number): number {
  if (typeof v === 'number') {
    if (!(Number.isFinite(v) && v >= 0)) throw new SnugclipError('INVALID_ARGUMENT', `Invalid time ${v}.`);
    return v;
  }
  const parts = v.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) {
    throw new SnugclipError('INVALID_ARGUMENT', `Invalid time "${v}". Use seconds (12.5) or m:ss (1:05).`);
  }
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function makeTrim(start: number | null | undefined, end: number | null | undefined, durationSec?: number): TrimRange | null {
  if (start == null && end == null) return null;
  const s = start ?? 0;
  const e = end ?? durationSec ?? Number.POSITIVE_INFINITY;
  if (!(e > s)) throw new SnugclipError('INVALID_ARGUMENT', `Trim end (${e}) must be after trim start (${s}).`);
  return { start: s, end: e };
}

/**
 * Resolves a target from a preset id/alias or a size string. Exactly one should be given;
 * a size wins if both are.
 */
export function resolveTarget(input: { preset?: string | null; size?: string | number | null; bytes?: number | null }): Target {
  if (input.bytes != null) return checkTarget({ bytes: Math.floor(input.bytes), label: formatTarget(Math.floor(input.bytes)) });
  if (input.size != null && input.size !== '') {
    const bytes = parseSize(input.size);
    if (bytes === null) throw new SnugclipError('INVALID_ARGUMENT', `Couldn't read size "${input.size}". Try 10MB, 9.5MiB or 800KB.`);
    return checkTarget({ bytes, label: formatTarget(bytes) });
  }
  if (input.preset) {
    const p = getPreset(input.preset);
    if (!p) throw new SnugclipError('INVALID_ARGUMENT', `Unknown preset "${input.preset}". Run \`snugclip presets\` to list them.`);
    return presetTarget(p);
  }
  throw new SnugclipError('INVALID_ARGUMENT', 'Give a target: a size (e.g. 10MB) or a preset (e.g. discord).');
}

function checkTarget(t: Target): Target {
  if (t.bytes < 10_000) throw new SnugclipError('INVALID_ARGUMENT', `Target ${t.bytes} bytes is too small; the minimum is 10 KB.`);
  if (t.bytes > MAX_TARGET_BYTES * 4) throw new SnugclipError('INVALID_ARGUMENT', `Target ${t.bytes} bytes is too large.`);
  return t;
}

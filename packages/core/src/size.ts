// Sizes, bitrates and durations: one tested implementation shared by the web UI, CLI and MCP,
// so no two surfaces ever round the same number differently (RULES §8, ACCEPTANCE A7).
import { SnugclipError } from './errors.js';
import type { Bytes, ContainerId, Target } from './types.js';

export const MB = 1_000_000;
export const MiB = 1_048_576;
/** Largest custom target (BRIEF: custom 1–4096 MB). Presets may exceed it (Telegram Premium 4 GB is below). */
export const MAX_CUSTOM_BYTES = 4096 * MB;

const UNITS: Record<string, number> = {
  b: 1,
  k: 1000,
  kb: 1000,
  kib: 1024,
  m: MB,
  mb: MB,
  mib: MiB,
  g: 1_000_000_000,
  gb: 1_000_000_000,
  gib: 1_073_741_824,
};

/**
 * "10MB" → 10,000,000; "10MiB" → 10,485,760; "10m" → 10,000,000; "1.5GB" → 1,500,000,000;
 * a number is bytes (1234 → 1234). A bare numeric string means MB when ≤ 100000 ("10" → 10 MB),
 * bytes otherwise. Throws E_ARGS for anything unparseable, ≤ 0, or above 4096 MB.
 */
export function parseSize(s: string | number): Bytes {
  let bytes: number;
  if (typeof s === 'number') {
    bytes = Math.floor(s);
  } else {
    const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-zA-Z]*)\s*$/.exec(s);
    if (!m) throw new SnugclipError('E_ARGS', `Couldn't read size "${s}". Try 10MB, 9.5MiB or 800KB.`);
    const value = Number(m[1]);
    const unit = (m[2] ?? '').toLowerCase();
    if (unit === '') bytes = value <= 100_000 ? value * MB : value;
    else {
      const mult = UNITS[unit];
      if (mult === undefined) throw new SnugclipError('E_ARGS', `Unknown size unit "${m[2]}" in "${s}". Use KB, MB, MiB or GB.`);
      bytes = value * mult;
    }
    bytes = Math.round(bytes);
  }
  if (!Number.isFinite(bytes) || bytes <= 0) throw new SnugclipError('E_ARGS', `Size must be more than 0 (got "${s}").`);
  if (bytes > MAX_CUSTOM_BYTES) throw new SnugclipError('E_ARGS', `Size ${formatSize(bytes, { round: 'nearest' })} is above the 4096 MB maximum.`);
  return bytes;
}

export type Rounding = 'floor' | 'ceil' | 'nearest';

export interface FormatSizeOptions {
  /**
   * Default `floor`, so a file that fits is never shown larger than its target
   * (9,999,999 B → "9.99 MB", not "10.00 MB"). Use `ceil` for minimum sizes.
   */
  round?: Rounding;
  decimals?: number;
}

function roundTo(value: number, decimals: number, mode: Rounding): number {
  const f = 10 ** decimals;
  const scaled = Number((value * f).toFixed(6)); // strip float noise before floor/ceil
  const r = mode === 'floor' ? Math.floor(scaled) : mode === 'ceil' ? Math.ceil(scaled) : Math.round(scaled);
  return r / f;
}

/**
 * Decimal units: "812 KB", "9.87 MB", "24.9 MB", "512 MB", "1.25 GB". Two decimals below 10,
 * one below 100, none above; whole numbers drop decimals ("10 MB", "14.5 MB").
 */
export function formatSize(b: Bytes, opts: FormatSizeOptions = {}): string {
  const round = opts.round ?? 'floor';
  if (!Number.isFinite(b) || b < 0) return '—';
  if (b < 1000) return `${Math.round(b)} B`;
  const [div, unit] = b < MB ? [1000, 'KB'] : b < 1e9 ? [MB, 'MB'] : [1e9, 'GB'];
  const value = b / div;
  const decimals = opts.decimals ?? (unit === 'KB' ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0);
  const r = roundTo(value, decimals, round);
  if (r >= 1000 && unit !== 'GB') return formatSize(r * div, { ...opts, round: 'nearest' });
  const text = Number.isInteger(r) ? String(r) : String(Number(r.toFixed(decimals)));
  return `${text} ${unit}`;
}

/** Compact target label for file names: "10MB", "14.5MB", "10MiB". */
export function sizeTag(bytes: Bytes): string {
  if (bytes % MB === 0) return `${bytes / MB}MB`;
  if (bytes % MiB === 0) return `${bytes / MiB}MiB`;
  return `${Number((bytes / MB).toFixed(2))}MB`;
}

/** Human target label: "10 MB", "14.5 MB", "10 MiB". */
export function targetLabel(bytes: Bytes): string {
  return sizeTag(bytes).replace(/(MiB|MB)$/, ' $1');
}

/** "96 kbps", "2.4 Mbps". */
export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—';
  if (bps < 1_000_000) return `${Math.round(bps / 1000)} kbps`;
  const v = bps / 1_000_000;
  return `${Number(v.toFixed(v < 10 ? 2 : 1))} Mbps`;
}

/** "8.4 s" under a minute, else "m:ss" / "h:mm:ss". */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${Number(sec.toFixed(1))} s`;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Share of the target used, floored to 0.1% (a fit never reads as 100%+). */
export function percentOfTarget(bytes: Bytes, targetBytes: Bytes): number {
  return targetBytes > 0 ? Math.floor((bytes / targetBytes) * 1000) / 10 : 0;
}

/** clip.mov → clip-snug-10MB.mp4 */
export function outputName(inputName: string, target: Target | Bytes, container: ContainerId): string {
  const bytes = typeof target === 'number' ? target : target.bytes;
  const base = inputName.replace(/\\/g, '/').split('/').pop() || 'video';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return `${stem || 'video'}-snug-${sizeTag(bytes)}.${container}`;
}

export const MIME: Record<ContainerId, string> = { mp4: 'video/mp4', webm: 'video/webm' };

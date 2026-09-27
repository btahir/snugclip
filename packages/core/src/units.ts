// Byte, bitrate and duration formatting shared by every surface (web, CLI, MCP).
// One tested implementation so the UI and CLI never round the same number differently.
import { MB, MiB } from './constants.js';

export type Rounding = 'floor' | 'ceil' | 'nearest';

const UNITS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
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
 * Parses a size such as `10MB`, `10 mb`, `9.5MiB`, `500KB`, `2GB` or `8000000` into bytes.
 * A bare number means megabytes when it is small (≤ 100000, e.g. `--size 10`) and bytes
 * otherwise (e.g. `--size 8000000`). Returns null for anything unparseable or ≤ 0.
 */
export function parseSize(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    return Math.floor(input);
  }
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  let bytes: number;
  if (unit === '') {
    bytes = value <= 100_000 ? value * MB : value;
  } else {
    const mult = UNITS[unit];
    if (mult === undefined) return null;
    bytes = value * mult;
  }
  bytes = Math.round(bytes);
  return bytes > 0 && Number.isFinite(bytes) ? bytes : null;
}

function roundTo(value: number, decimals: number, mode: Rounding): number {
  const f = 10 ** decimals;
  // Guard against float noise such as 9.999999999 → 9.99 on floor.
  const scaled = Number((value * f).toFixed(6));
  const r = mode === 'floor' ? Math.floor(scaled) : mode === 'ceil' ? Math.ceil(scaled) : Math.round(scaled);
  return r / f;
}

export interface FormatBytesOptions {
  /**
   * Rounding mode. Default `floor`, so an output that fits is never displayed as larger
   * than its target (9,999,999 B shows as "9.99 MB", not "10.00 MB"). Use `ceil` for
   * minimum sizes and `nearest` for neutral figures.
   */
  round?: Rounding;
  /** Force a number of decimals instead of the adaptive default. */
  decimals?: number;
}

/**
 * Formats bytes as decimal units: `812 KB`, `9.87 MB`, `24.9 MB`, `512 MB`, `1.25 GB`.
 * Adaptive decimals: 2 below 10, 1 below 100, 0 otherwise. Whole numbers drop decimals
 * (`10 MB`, not `10.00 MB`).
 */
export function formatBytes(bytes: number, opts: FormatBytesOptions = {}): string {
  const round = opts.round ?? 'floor';
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  let value: number;
  let unit: string;
  if (bytes < MB) {
    value = bytes / 1000;
    unit = 'KB';
  } else if (bytes < 1_000_000_000) {
    value = bytes / MB;
    unit = 'MB';
  } else {
    value = bytes / 1_000_000_000;
    unit = 'GB';
  }
  const decimals = opts.decimals ?? (unit === 'KB' ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0);
  let r = roundTo(value, decimals, round);
  // Rounding up can cross a unit boundary (999.6 KB → 1000 KB); re-express in the next unit.
  if (unit === 'KB' && r >= 1000) return formatBytes(MB * Math.ceil(r / 1000), opts);
  if (unit === 'MB' && r >= 1000) return formatBytes(1_000_000_000 * (r / 1000), opts);
  const text = Number.isInteger(r) ? String(r) : r.toFixed(decimals);
  return `${text} ${unit}`;
}

/** Formats a target size for labels: whole MB when exact (`10 MB`), else like formatBytes nearest. */
export function formatTarget(bytes: number): string {
  if (bytes % MB === 0) return `${bytes / MB} MB`;
  if (bytes % MiB === 0) return `${bytes / MiB} MiB`;
  return formatBytes(bytes, { round: 'nearest' });
}

/** Formats bits per second: `96 kbps`, `2.4 Mbps`. */
export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—';
  if (bps < 1_000_000) return `${Math.round(bps / 1000)} kbps`;
  const v = bps / 1_000_000;
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} Mbps`;
}

/** Formats seconds as `m:ss` or `h:mm:ss`, with tenths when under a minute and fractional. */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60 && !Number.isInteger(sec)) return `${sec.toFixed(1)} s`;
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Percentage of the target a size uses, floored to one decimal (never shows 100% for a fit). */
export function percentOfTarget(bytes: number, targetBytes: number): number {
  if (targetBytes <= 0) return 0;
  return Math.floor((bytes / targetBytes) * 1000) / 10;
}

/** Suggested output filename: `clip-snug-10MB.mp4`. */
export function outputName(inputName: string, targetBytes: number, container: string): string {
  const base = inputName.replace(/\\/g, '/').split('/').pop() ?? 'video';
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const label = formatTarget(targetBytes).replace(/\s+/g, '').replace(/\./g, '_');
  return `${stem || 'video'}-snug-${label}.${container}`;
}

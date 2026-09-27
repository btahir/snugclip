// Thin wrappers over @snugclip/core's formatters (the only size formatter in the app).
import { formatDuration, formatSize, targetLabel } from '@snugclip/core';

/** A limit for labels: "20 MB", "14.5 MB", "1 GB", "2 GB". */
export function limitText(bytes: number): string {
  return bytes >= 1_000_000_000 ? formatSize(bytes, { round: 'nearest' }) : targetLabel(bytes);
}

/** Spare room under the limit: always floored so it never overstates the room. */
export function spareText(bytes: number, target: number): string {
  return formatSize(Math.max(0, target - bytes));
}

/** "−89%" with a real minus sign. */
export function reductionText(from: number, to: number): string {
  if (!(from > 0)) return '';
  const pct = Math.round((1 - to / from) * 100);
  return pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : '0%';
}

/** Seconds as m:ss (or h:mm:ss) for players and metadata lines. */
export function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** m:ss.s for trim handles. */
export function clockTenths(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

/** "about 41 s left" style ETA text. */
export function etaText(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : formatDuration(s);
}

export function resolutionText(w?: number, h?: number, fps?: number): string {
  if (!w || !h) return '';
  const p = `${Math.min(w, h)}p`;
  return fps ? `${p}${Math.round(fps)}` : p;
}

export { formatSize, formatDuration, targetLabel };

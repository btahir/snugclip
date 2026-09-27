// Human-mode output. Sizes always go through core's formatSize so the CLI and the web UI agree.
import { basename } from 'node:path';
import { formatBitrate, formatDuration, formatSize, percentOfTarget, type FitProgress, type Plan, type Preset, type Probe, type Report } from '@snugclip/core';
import type { PlanResult, ProbeResult } from '@snugclip/engine-ffmpeg';

const pad = (s: string, n: number) => (s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length));

export function reportLine(r: Report): string {
  const name = r.input.name;
  switch (r.status) {
    case 'fit': {
      const o = r.output!;
      const v = o.video;
      const q = r.quality ? ` · ${r.quality.label} (SSIM ${r.quality.ssimMean.toFixed(3)})` : '';
      const full = r.attempts.filter((a) => a.purpose !== 'calibration').length;
      return `${pad('fit', 12)}${name} → ${o.name}  ${formatSize(o.bytes)} of ${r.target.label} (${percentOfTarget(o.bytes, r.target.bytes)}%)${v ? ` · ${v.width}x${v.height} ${v.fps} fps ${v.codec.toUpperCase()}` : ''}${q} · ${full} attempt${full === 1 ? '' : 's'} · ${formatDuration(r.elapsedMs / 1000)}`;
    }
    case 'passthrough':
      return `${pad('passthrough', 12)}${name} → ${r.output!.name}  ${formatSize(r.output!.bytes)}, already under ${r.target.label} (copied untouched)`;
    case 'impossible':
      return `${pad('impossible', 12)}${name}: too big for ${r.target.label}. The smallest Snugclip can make is ${formatSize(r.minimumBytes ?? 0, { round: 'ceil' })}. Trim it, mute it, or pick a bigger limit.`;
    default:
      return `${pad(r.status, 12)}${name}: ${r.error?.message ?? 'failed'}${r.error?.hint ? ` (${r.error.hint})` : ''}`;
  }
}

export function warningLines(r: Report): string[] {
  return r.warnings.map((w) => `  ! ${w.message}`);
}

export function progressLine(input: string, p: FitProgress): string {
  const what = p.phase === 'encoding' ? `encoding, attempt ${p.attempt}` : p.phase === 'calibrating' ? `measuring (sample ${p.attempt})` : p.phase === 'checking' ? 'checking quality' : p.phase;
  const eta = p.etaMs !== null && p.phase !== 'done' ? `  ETA ${formatDuration(Math.round(p.etaMs / 1000))}` : '';
  return `  ${basename(input)}  ${what}  ${Math.floor(p.overall * 100)}%${eta}`;
}

export function planLines(r: PlanResult): string[] {
  if (!r.plan) return [`${pad(r.error?.code === 'E_UNSUPPORTED' ? 'unsupported' : 'error', 12)}${r.input}: ${r.error?.message ?? ''}`];
  const p: Plan = r.plan;
  const head = p.passThrough
    ? `${pad('passthrough', 12)}${r.input}`
    : p.feasible
      ? `${pad('plan', 12)}${r.input}  ${p.video!.width}x${p.video!.height} ${p.video!.fps} fps ${p.video!.codec.toUpperCase()} ${formatBitrate(p.video!.bitrate)} · tier ${p.video!.bppTier}`
      : `${pad('impossible', 12)}${r.input}  minimum ${formatSize(p.minimumBytes, { round: 'ceil' })}`;
  return [head, ...p.reasons.map((x) => `  ${x}`), ...p.warnings.map((w) => `  ! ${w.message}`)];
}

export function probeLine(r: ProbeResult): string {
  if (!r.probe) return `${pad(r.error?.code === 'E_UNSUPPORTED' ? 'unsupported' : 'error', 12)}${r.input}: ${r.error?.message ?? ''}`;
  const p: Probe = r.probe;
  const v = p.video!;
  const a = p.audio ? `${p.audio.codec} ${p.audio.channels}ch${p.audio.bitrate ? ` ${formatBitrate(p.audio.bitrate)}` : ''}` : 'no audio';
  return `${pad(p.container, 12)}${r.input}  ${formatSize(p.sizeBytes)} · ${formatDuration(p.durationSec)} · ${v.codec} ${v.displayWidth}x${v.displayHeight} ${v.fps} fps${v.rotation ? ` (rotated ${v.rotation}°)` : ''}${v.hdr ? ' HDR' : ''} · ${a}`;
}

export function presetLines(presets: readonly Preset[]): string[] {
  return presets.map((p) => `${pad(p.id, 22)}${pad(formatSize(p.bytes), 10)}${p.label}${p.maxShortSide ? ` (≤ ${p.maxShortSide}p)` : ''}`);
}

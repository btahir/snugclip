// Pure state model for the tool page: items, target, options and the reducer. No DOM, so
// it is unit-tested directly (test/tool-model.test.ts).
import {
  plan as corePlan,
  type CodecChoice,
  type EngineCapabilities,
  type FitProgress,
  type Options,
  type Probe,
  type Report,
  type Target,
  type TrimRange,
} from '@snugclip/core';
import type { WireCaps } from '@/workers/protocol';

export type ItemStatus = 'probing' | 'queued' | 'running' | 'ready' | 'impossible' | 'error' | 'cancelled';

export interface PlanPreview {
  feasible: boolean;
  passThrough: boolean;
  projectedBytes: number;
  minimumBytes: number;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  targetBytes: number;
}

export interface ItemError {
  code: string;
  message: string;
  codec?: string;
}

export interface Item {
  id: string;
  file: File;
  name: string;
  bytes: number;
  status: ItemStatus;
  paused: boolean;
  stalled: boolean;
  probe?: Probe;
  preview?: PlanPreview;
  trim?: TrimRange;
  /** Per-item option overrides ("Re-encode anyway", "Mute audio" on a refused clip). */
  overrides?: Partial<UiOptions>;
  thumb?: string;
  progress?: FitProgress;
  /** Target and options this item was (or is being) compressed with. */
  runTarget?: Target;
  report?: Report;
  output?: Blob;
  outputUrl?: string;
  outputName?: string;
  downloaded: boolean;
  error?: ItemError;
}

export interface UiOptions {
  codec: CodecChoice;
  mute: boolean;
  keepFps: boolean;
  maxShortSide?: number;
  fpsCap?: number;
  reencode: boolean;
}

export const DEFAULT_UI_OPTIONS: UiOptions = { codec: 'compatible', mute: false, keepFps: false, reencode: false };

export interface ToolState {
  target: Target;
  options: UiOptions;
  /** Trim from a deep link / job file, applied to every file dropped afterwards. */
  defaultTrim?: TrimRange;
  items: Item[];
  expandedId: string | null;
  trimId: string | null;
}

export type Action =
  | { type: 'setTarget'; target: Target }
  | { type: 'setOptions'; options: Partial<UiOptions> }
  | { type: 'setDefaultTrim'; trim: TrimRange | undefined }
  | { type: 'add'; items: Item[] }
  | { type: 'update'; id: string; patch: Partial<Item> }
  | { type: 'remove'; id: string }
  | { type: 'expand'; id: string | null }
  | { type: 'trim'; id: string | null }
  | { type: 'clearDone' };

export function reducer(s: ToolState, a: Action): ToolState {
  switch (a.type) {
    case 'setTarget':
      return { ...s, target: a.target };
    case 'setOptions':
      return { ...s, options: { ...s.options, ...a.options } };
    case 'setDefaultTrim':
      return a.trim ? { ...s, defaultTrim: a.trim } : { ...s, defaultTrim: undefined as never };
    case 'add':
      return { ...s, items: [...s.items, ...a.items] };
    case 'update':
      return { ...s, items: s.items.map((it) => (it.id === a.id ? { ...it, ...a.patch } : it)) };
    case 'remove':
      return {
        ...s,
        items: s.items.filter((it) => it.id !== a.id),
        expandedId: s.expandedId === a.id ? null : s.expandedId,
        trimId: s.trimId === a.id ? null : s.trimId,
      };
    case 'expand':
      return { ...s, expandedId: a.id };
    case 'trim':
      return { ...s, trimId: a.id };
    case 'clearDone': {
      const keep = s.items.filter((it) => it.status !== 'ready' && it.status !== 'cancelled');
      return { ...s, items: keep, expandedId: keep.some((i) => i.id === s.expandedId) ? s.expandedId : null };
    }
  }
}

/** Core options for one item: page options + that item's trim. */
export function coreOptions(base: UiOptions, trim?: TrimRange, overrides?: Partial<UiOptions>): Partial<Options> {
  const o = overrides ? { ...base, ...overrides } : base;
  const out: Partial<Options> = { codec: o.codec, mute: o.mute, keepFps: o.keepFps, reencode: o.reencode };
  if (o.maxShortSide) out.maxShortSide = o.maxShortSide;
  if (o.fpsCap) out.fpsCap = o.fpsCap;
  if (trim) out.trim = trim;
  return out;
}

/** Rebuilds a synchronous canEncode from wire capabilities (the worker keeps the real one). */
export function capsFromWire(w: WireCaps): EngineCapabilities {
  const { audioOk, ...rest } = w;
  const ok = audioOk ? new Set(audioOk) : null;
  return {
    ...rest,
    canEncode: (codec, width, height) => w.videoCodecs.includes(codec) && Math.min(width, height) <= (w.maxEncodeShortSide[codec] ?? 8640),
    ...(ok ? { canEncodeAudio: (codec: string, bitrate: number, channels: number, sampleRate: number) => ok.has(`${codec}:${bitrate}:${channels}:${sampleRate}`) } : {}),
  };
}

/** The planner's view of an item before it runs: will it fit, where will it land, the minimum. */
export function previewPlan(probe: Probe, target: Target, options: Partial<Options>, caps: EngineCapabilities): PlanPreview | null {
  try {
    const p = corePlan(probe, target, options, caps);
    let projected = p.targetBytes - p.marginBytes;
    if (p.video) {
      const est = Math.round((p.video.bitrate * p.durationSec) / 8 + p.audio.bytes + p.overheadBytes);
      projected = Math.min(projected, est);
    }
    if (p.passThrough) projected = probe.sizeBytes;
    return {
      feasible: p.feasible,
      passThrough: p.passThrough,
      projectedBytes: Math.max(0, projected),
      minimumBytes: p.minimumBytes,
      targetBytes: p.targetBytes,
      ...(p.video ? { width: p.video.width, height: p.video.height, fps: p.video.fps, codec: p.video.codec } : {}),
    };
  } catch {
    return null;
  }
}

export interface QueueSummary {
  total: number;
  ready: number;
  running: number;
  waiting: number;
  attention: number;
}

export function summarize(items: Item[]): QueueSummary {
  let ready = 0;
  let running = 0;
  let waiting = 0;
  let attention = 0;
  for (const it of items) {
    if (it.status === 'ready') ready++;
    else if (it.status === 'running') running++;
    else if (it.status === 'queued' || it.status === 'probing') waiting++;
    else if (it.status === 'impossible' || it.status === 'error') attention++;
  }
  return { total: items.length, ready, running, waiting, attention };
}

/** The next item the runner should start (sequential queue), or null. */
export function nextRunnable(items: Item[]): Item | null {
  if (items.some((i) => i.status === 'running')) return null;
  return items.find((i) => i.status === 'queued') ?? null;
}

/**
 * Longest trimmed duration that still fits, for the "Trim it to under N s" advice. The
 * minimum size grows about linearly with duration, so scale and round down to 0.1 s.
 */
export function maxFittingDuration(durationSec: number, minimumBytes: number, targetBytes: number): number {
  if (minimumBytes <= 0 || durationSec <= 0) return durationSec;
  const d = (durationSec * targetBytes) / minimumBytes;
  return Math.max(0, Math.floor(d * 0.97 * 10) / 10);
}

/** Level of liquid in the glass: bytes/target clamped to [0, 1]. The line sits at 78%. */
export function fillLevel(bytes: number, target: number): number {
  if (!(target > 0) || !(bytes > 0)) return 0;
  return Math.min(1, bytes / target);
}

let seq = 0;
export function newId(): string {
  seq += 1;
  return `c${Date.now().toString(36)}${seq}`;
}

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpg|mpeg|ts|m2ts|3gp|3g2|ogv|qt)$/i;

const AUDIO_EXT = /\.(m4a|mp3|wav|aac|flac|ogg|opus)$/i;

/** Files worth probing: videos, plus audio so an audio-only file gets a clear "no video track" message. */
export function isProbablyVideo(f: File): boolean {
  return f.type.startsWith('video/') || f.type.startsWith('audio/') || VIDEO_EXT.test(f.name) || AUDIO_EXT.test(f.name);
}

export function isJobFile(f: File): boolean {
  return /\.snugclip\.json$/i.test(f.name) || (f.type === 'application/json' && /snugclip/i.test(f.name));
}

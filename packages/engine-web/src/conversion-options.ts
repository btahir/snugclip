// EncodePlan → mediabunny options (PLAN §8.2–8.3). Pure apart from constructing mediabunny's
// `Quality` value objects, which is safe in Node, so the mapping is unit-tested.
import type { ContainerId, EncodePlan, TrimRange } from '@snugclip/core';
import { SnugclipError } from '@snugclip/core';
import { Quality } from 'mediabunny';
import type { ConversionAudioOptions, ConversionVideoOptions, VideoEncodingConfig } from 'mediabunny';
import { toMediabunnyAudioCodec, toMediabunnyVideoCodec } from './codec-strings.js';

/** Outputs estimated above this go to an OPFS file instead of memory (PLAN §8.2). */
export const BUFFER_TARGET_MAX_BYTES = 512_000_000;
/** Extra room asked of the storage quota over the estimate. */
export const QUOTA_HEADROOM = 1.25;

type VideoProcess = NonNullable<ConversionVideoOptions['process']>;

/** The media range an encode covers, in the source timeline. */
export interface MediaRange {
  start: number;
  end: number;
  len: number;
}

/**
 * The range to encode. With no trim it starts at 0 (not at the first packet), so output time t
 * always maps to source time `trim.startSec + t` — the exact mapping the core uses when it asks
 * for matched quality frames.
 */
export function resolveRange(trim: TrimRange | undefined, sourceDurationSec: number): MediaRange {
  const dur = Number.isFinite(sourceDurationSec) && sourceDurationSec > 0 ? sourceDurationSec : Infinity;
  const start = Math.max(0, trim?.startSec ?? 0);
  const end = Math.min(trim?.endSec ?? dur, dur);
  return { start, end, len: Number.isFinite(end) ? Math.max(0, end - start) : 0 };
}

/** `Conversion.init({ trim })` value. `end` is left out when the encode runs to the end. */
export function conversionTrim(range: MediaRange, trim: TrimRange | undefined): { start: number; end?: number } {
  return trim && Number.isFinite(range.end) ? { start: range.start, end: range.end } : { start: range.start };
}

export function videoQuality(bitrate: number): Quality {
  return new Quality({ bitrate: Math.max(1000, Math.round(bitrate)), bitrateMode: 'variable' });
}

/** Conversion path video options: exact size, fps and bitrate; rotation baked into the pixels. */
export function buildVideoOptions(plan: EncodePlan<unknown>, process?: VideoProcess, opts: { ownFrameRate?: boolean } = {}): ConversionVideoOptions {
  const v = plan.video;
  const o: ConversionVideoOptions = {
    codec: toMediabunnyVideoCodec(v.codec),
    width: v.width,
    height: v.height,
    fit: 'fill',
    ...(opts.ownFrameRate ? {} : { frameRate: v.fps }),
    quality: videoQuality(v.bitrate),
    keyFrameInterval: v.keyframeIntervalSec,
    forceTranscode: true,
    hardwareAcceleration: 'no-preference',
    // Bake rotation into the frames: some chat previews ignore rotation metadata.
    allowTransformationMetadata: false,
  };
  if (process) {
    o.process = process;
    o.processedWidth = v.width;
    o.processedHeight = v.height;
  }
  return o;
}

/** Audio options for mode none | copy | encode. */
export function buildAudioOptions(audio: EncodePlan<unknown>['audio']): ConversionAudioOptions {
  if (audio.mode === 'none') return { discard: true };
  if (audio.mode === 'copy') return { forceTranscode: false };
  if (!audio.codec || !audio.bitrate) throw new SnugclipError('E_INTERNAL', 'Audio encode plan is missing its codec or bitrate.');
  const o: ConversionAudioOptions = {
    codec: toMediabunnyAudioCodec(audio.codec),
    quality: new Quality({ bitrate: Math.round(audio.bitrate) }),
    forceTranscode: true,
  };
  if (audio.channels) o.numberOfChannels = audio.channels;
  if (audio.sampleRate) o.sampleRate = audio.sampleRate;
  return o;
}

/** Manual-pipeline encoder config (the only way to set `latencyMode`, PLAN §8.3). */
export function buildVideoEncodingConfig(
  plan: EncodePlan<unknown>,
  latency: 'quality' | 'realtime',
  extra: { process?: VideoProcess; onEncodedPacket?: VideoEncodingConfig['onEncodedPacket']; ownFrameRate?: boolean } = {},
): VideoEncodingConfig {
  const v = plan.video;
  const cfg: VideoEncodingConfig = {
    codec: toMediabunnyVideoCodec(v.codec),
    quality: videoQuality(v.bitrate),
    keyFrameInterval: v.keyframeIntervalSec,
    latencyMode: latency,
    hardwareAcceleration: 'no-preference',
    sizeChangeBehavior: 'passThrough',
    transform: { width: v.width, height: v.height, fit: 'fill', ...(extra.ownFrameRate ? {} : { frameRate: v.fps }), force: true },
  };
  if (extra.process) cfg.transform!.process = extra.process;
  if (extra.onEncodedPacket) cfg.onEncodedPacket = extra.onEncodedPacket;
  return cfg;
}

/** Latency actually used: the core's request, or 'realtime' when the capability probe found stalls. */
export function effectiveLatency(requested: 'quality' | 'realtime' | undefined, probed: 'quality' | 'realtime'): 'quality' | 'realtime' {
  return requested === 'realtime' || probed === 'realtime' ? 'realtime' : 'quality';
}

/** Expected output bytes from the requested bitrates (used only to pick memory vs OPFS). */
export function estimateOutputBytes(plan: EncodePlan<unknown>, lenSec: number): number {
  const audioBps = plan.audio.mode === 'none' ? 0 : (plan.audio.bitrate ?? 0);
  return Math.ceil(((plan.video.bitrate + audioBps) * Math.max(0, lenSec)) / 8);
}

export type TargetKind = 'buffer' | 'opfs';

export function chooseTargetKind(estimatedBytes: number, opts: { opfsAvailable: boolean; maxBufferBytes?: number }): TargetKind {
  const max = opts.maxBufferBytes ?? BUFFER_TARGET_MAX_BYTES;
  return opts.opfsAvailable && estimatedBytes * 1.3 > max ? 'opfs' : 'buffer';
}

export type OutputFormatSpec = { container: 'mp4'; fastStart: false | 'in-memory' } | { container: 'webm' };

/** MP4 is fast-start in memory; streamed to OPFS it keeps the index at the end (PLAN §8.2). */
export function outputFormatSpec(container: ContainerId, kind: TargetKind): OutputFormatSpec {
  return container === 'webm' ? { container: 'webm' } : { container: 'mp4', fastStart: kind === 'buffer' ? 'in-memory' : false };
}

export type DiscardReason =
  | 'discarded_by_user'
  | 'max_track_count_reached'
  | 'max_track_count_of_type_reached'
  | 'unknown_source_codec'
  | 'undecodable_source_codec'
  | 'no_encodable_target_codec'
  | 'cannot_copy';

/**
 * Turns `Conversion.discardedTracks` into a Snugclip error when a track we need was dropped.
 * A silently dropped audio track would break the byte budget and surprise the user, so it's an
 * error too (the planner mutes explicitly when the user asks).
 */
export function assessDiscarded(
  discarded: ReadonlyArray<{ type: string; reason: DiscardReason | string }>,
  expect: { video: boolean; audio: boolean },
): SnugclipError | null {
  for (const d of discarded) {
    if (d.reason === 'discarded_by_user') continue;
    if (d.type === 'video' && expect.video) {
      if (d.reason === 'no_encodable_target_codec') {
        return new SnugclipError('E_UNSUPPORTED_ENCODER', "This browser can't encode video in the chosen format.", { hint: 'Try the Compatible (H.264) setting or another browser.' });
      }
      return new SnugclipError('E_UNSUPPORTED', "This browser can't decode this video.", {
        hint: 'Snugclip handles MP4, MOV, M4V, WebM and MKV with H.264, HEVC, VP9 or AV1. The CLI (ffmpeg) can do this one.',
        details: { reason: d.reason },
      });
    }
    if (d.type === 'audio' && expect.audio) {
      if (d.reason === 'no_encodable_target_codec') {
        return new SnugclipError('E_UNSUPPORTED_ENCODER', "This browser can't encode the audio.", { hint: 'Mute the clip, or use Chrome or Edge.' });
      }
      return new SnugclipError('E_UNSUPPORTED', "This browser can't decode this file's audio.", { hint: 'Mute the clip to compress the picture only.', details: { reason: d.reason } });
    }
  }
  return null;
}

/** Pause steps for `Conversion.execute({ until })`, in output seconds. */
export const PAUSE_STEP_SEC = 2;

/**
 * Next `until` for a stepped execute. A step that ran to its `until` advances by one step; a step
 * cut short by a pause resumes towards the same `until`. Infinity once past the end, so the last
 * step always finishes (and a stuck progress counter can never loop forever).
 */
export function nextUntil(prevUntil: number, processedSec: number, lenSec: number, interrupted: boolean, step: number = PAUSE_STEP_SEC): number {
  const next = interrupted ? Math.max(prevUntil, processedSec + step) : Math.max(prevUntil + step, processedSec + step);
  return !(lenSec > 0) || next >= lenSec + step ? Infinity : next;
}

/** True when the output drops frames relative to a known source frame rate. */
export function needsFrameRateConversion(outFps: number, srcFps: number | undefined): srcFps is number {
  return srcFps !== undefined && Number.isFinite(srcFps) && srcFps > 0 && outFps < srcFps - 0.01;
}

/**
 * Nearest-neighbour frame-rate conversion, like ffmpeg's fps filter: output frame k (at k/outFps)
 * shows the source frame nearest to k/outFps. mediabunny's own `frameRate` keeps the *last* source
 * frame in each output slot, which shifts content up to one output frame early and made web SSIM
 * compare the wrong frames (V2). Feed source timestamps in presentation order (0-based, trim
 * applied); returns the output slots this frame fills. A frame fills every not-yet-filled slot
 * whose time is before its own time + half a source frame, so VFR gaps are filled by the next frame.
 */
export function frameSlotMapper(outFps: number, srcFps: number, endSec: number): (timestampSec: number) => number[] {
  const half = 0.5 / srcFps;
  let lastK = -1;
  return (ts) => {
    const limit = Math.min(ts + half, endSec);
    const kMax = Math.ceil(limit * outFps - 1e-9) - 1;
    const out: number[] = [];
    for (let k = lastK + 1; k <= kMax; k++) out.push(k);
    if (kMax > lastK) lastK = kMax;
    return out;
  };
}

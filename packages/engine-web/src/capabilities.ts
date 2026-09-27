// EngineCapabilities for the web engine (PLAN §8.2): built from a table of `canEncodeVideo`
// results at three probe sizes, so `canEncode()` can stay synchronous as the core requires.
// Pure: the async probing lives in engine.ts.
import type { AudioCodecId, ContainerId, EngineCapabilities, VideoCodecId } from '@snugclip/core';
import { AUDIO_CODEC_IDS, containerForVideoCodec, encoderNames, VIDEO_CODEC_IDS } from './codec-strings.js';

export const ENGINE_VERSION = '0.1.0';
/** Pinned; a test checks it matches the installed package. */
export const MEDIABUNNY_VERSION = '1.60.0';

export type ProbeTier = 720 | 1080 | 2160;
/** Landscape probe sizes, smallest first. Portrait sizes are treated symmetrically. */
export const PROBE_TIERS: ReadonlyArray<{ tier: ProbeTier; width: number; height: number }> = [
  { tier: 720, width: 1280, height: 720 },
  { tier: 1080, width: 1920, height: 1080 },
  { tier: 2160, width: 3840, height: 2160 },
];

/** A generous bitrate for the probe config (0.1 bits per pixel at 30 fps). */
export function probeBitrate(width: number, height: number): number {
  return Math.round(0.1 * width * height * 30);
}

export type EncodeTable = Record<VideoCodecId, Record<ProbeTier, boolean>>;

export interface CapabilityInputs {
  video: EncodeTable;
  audio: Record<AudioCodecId, boolean>;
}

export function emptyEncodeTable(): EncodeTable {
  const row = (): Record<ProbeTier, boolean> => ({ 720: false, 1080: false, 2160: false });
  return { h264: row(), hevc: row(), av1: row(), vp9: row() };
}

/** The smallest probe tier that covers w×h (either orientation), or null when larger than 4K. */
export function tierFor(width: number, height: number): ProbeTier | null {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  for (const t of PROBE_TIERS) if (short <= t.height && long <= t.width) return t.tier;
  return null;
}

/** Synchronous canEncode over a precomputed table. */
export function makeCanEncode(table: EncodeTable): EngineCapabilities['canEncode'] {
  return (codec, w, h, bps) => {
    if (!(w > 0 && h > 0) || !(bps > 0)) return false;
    const row = table[codec];
    if (!row) return false;
    const t = tierFor(w, h);
    return t !== null && row[t];
  };
}

/** Largest tier (short side) each codec can encode; codecs that fail even 720p are omitted. */
export function maxShortSides(table: EncodeTable): Partial<Record<VideoCodecId, number>> {
  const out: Partial<Record<VideoCodecId, number>> = {};
  for (const c of VIDEO_CODEC_IDS) {
    let max = 0;
    for (const t of PROBE_TIERS) if (table[c][t.tier]) max = t.tier;
    if (max > 0) out[c] = max;
  }
  return out;
}

export function buildCapabilities(inputs: CapabilityInputs): EngineCapabilities {
  const videoCodecs = VIDEO_CODEC_IDS.filter((c) => inputs.video[c][720]);
  const audioCodecs = AUDIO_CODEC_IDS.filter((c) => inputs.audio[c]);
  const containers: ContainerId[] = [];
  if (videoCodecs.some((c) => containerForVideoCodec(c) === 'mp4')) containers.push('mp4');
  if (videoCodecs.some((c) => containerForVideoCodec(c) === 'webm')) containers.push('webm');
  return {
    id: 'web',
    version: `${ENGINE_VERSION} (mediabunny ${MEDIABUNNY_VERSION})`,
    encoderName: encoderNames(videoCodecs),
    videoCodecs,
    audioCodecs,
    containers,
    twoPass: false,
    initialMargin: 0.04,
    rateCalibration: 'always',
    audioCopyWithTrim: false,
    maxEncodeShortSide: maxShortSides(inputs.video),
    canEncode: makeCanEncode(inputs.video),
  };
}

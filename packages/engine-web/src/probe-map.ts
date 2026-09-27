// Maps what mediabunny tells us about a file (gathered by the thin browser-side probe) to the
// core's `Probe` (PLAN §4.9, §8.2). Pure, so every mapping rule is unit-tested in Node.
import type { Probe, ProbeAudio, ProbeVideo } from '@snugclip/core';
import { bitDepthFromCodecString, normalizeAudioCodec, normalizeVideoCodec } from './codec-strings.js';

/** Plain data read from an `InputVideoTrack`. */
export interface RawVideoTrack {
  /** mediabunny `VideoCodec` or null when unknown. */
  codec: string | null;
  internalCodecId?: string | number | Uint8Array | null;
  /** WebCodecs codec string, e.g. "avc1.64001f". */
  codecString?: string | null;
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  /** Clockwise degrees, as mediabunny reports it. */
  rotation: number;
  /** `computeFrameRateMetrics().bestGuessFrameRate` */
  fps?: number | null;
  /** `computePacketStats().averagePacketRate` (fallback for fps). */
  packetRate?: number | null;
  frameCount?: number | null;
  /** bits/s measured from packets. */
  measuredBitrate?: number | null;
  /** bits/s from container metadata. */
  metadataBitrate?: number | null;
  /** `hasHighDynamicRange()` */
  hdr: boolean;
  colorSpace?: { primaries?: string | null; transfer?: string | null; matrix?: string | null } | null;
  decodable: boolean;
}

export interface RawAudioTrack {
  codec: string | null;
  internalCodecId?: string | number | Uint8Array | null;
  channels: number;
  sampleRate: number;
  measuredBitrate?: number | null;
  metadataBitrate?: number | null;
  decodable: boolean;
}

export interface RawProbe {
  /** `InputFormat.name`, e.g. "MP4", "QuickTime File Format", "WebM". */
  formatName: string | null;
  sizeBytes: number;
  durationSec: number;
  video: RawVideoTrack | null;
  audio: RawAudioTrack | null;
}

const FORMAT_NAMES: Record<string, string> = {
  mp4: 'mp4',
  'quicktime file format': 'mov',
  quicktime: 'mov',
  matroska: 'mkv',
  webm: 'webm',
  'mpeg transport stream': 'mpegts',
  ogg: 'ogg',
  mp3: 'mp3',
  wave: 'wav',
  flac: 'flac',
  adts: 'aac',
  'http live streaming (hls)': 'hls',
};

/** mediabunny input format name → the core's container string ('mp4'|'mov'|'webm'|'mkv'|…|'unknown'). */
export function containerFromFormatName(name: string | null | undefined): string {
  if (!name) return 'unknown';
  return FORMAT_NAMES[name.trim().toLowerCase()] ?? 'unknown';
}

/** Any angle → 0|90|180|270 clockwise (negative angles and multiples of 360 allowed). */
export function normalizeRotation(deg: number | null | undefined): 0 | 90 | 180 | 270 {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 0;
  const q = Math.round(deg / 90) * 90;
  const r = ((q % 360) + 360) % 360;
  return r === 90 ? 90 : r === 180 ? 180 : r === 270 ? 270 : 0;
}

const TRANSFER_NAMES: Record<string, string> = {
  pq: 'smpte2084',
  hlg: 'arib-std-b67',
  bt709: 'bt709',
  smpte170m: 'smpte170m',
  'iec61966-2-1': 'iec61966-2-1',
  linear: 'linear',
};

/** WebCodecs transfer name → ffprobe's name (so reports read the same on web and CLI). */
export function transferName(t: string | null | undefined): string | undefined {
  if (!t) return undefined;
  return TRANSFER_NAMES[t] ?? t;
}

/** HDR when mediabunny says so, or the transfer is PQ/HLG. */
export function isHdr(flag: boolean, colorSpace: RawVideoTrack['colorSpace']): boolean {
  if (flag) return true;
  const t = colorSpace?.transfer;
  return t === 'pq' || t === 'hlg';
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function pickFps(fps: number | null | undefined, packetRate: number | null | undefined): number {
  if (positive(fps)) return round3(fps);
  if (positive(packetRate)) return round3(packetRate);
  return 0; // the core treats 0 as "unknown" and assumes 30
}

export function pickBitrate(measured: number | null | undefined, metadata: number | null | undefined): number | undefined {
  if (positive(measured)) return Math.round(measured);
  if (positive(metadata)) return Math.round(metadata);
  return undefined;
}

export function mapVideo(v: RawVideoTrack): ProbeVideo {
  const rotation = normalizeRotation(v.rotation);
  let displayWidth = v.displayWidth;
  let displayHeight = v.displayHeight;
  if (!(displayWidth > 0 && displayHeight > 0)) {
    // Fall back to coded dims, swapped for quarter turns.
    const swap = rotation === 90 || rotation === 270;
    displayWidth = swap ? v.codedHeight : v.codedWidth;
    displayHeight = swap ? v.codedWidth : v.codedHeight;
  }
  const out: ProbeVideo = {
    codec: normalizeVideoCodec(v.codec, v.internalCodecId),
    decodable: v.decodable,
    codedWidth: v.codedWidth,
    codedHeight: v.codedHeight,
    displayWidth,
    displayHeight,
    rotation,
    fps: pickFps(v.fps, v.packetRate),
    hdr: isHdr(v.hdr, v.colorSpace),
  };
  if (positive(v.frameCount)) out.frameCount = Math.round(v.frameCount);
  const bitrate = pickBitrate(v.measuredBitrate, v.metadataBitrate);
  if (bitrate !== undefined) out.bitrate = bitrate;
  const transfer = transferName(v.colorSpace?.transfer);
  if (transfer) out.transfer = transfer;
  if (v.colorSpace?.primaries) out.primaries = v.colorSpace.primaries;
  const depth = bitDepthFromCodecString(v.codecString);
  if (depth !== undefined) out.bitDepth = depth;
  return out;
}

export function mapAudio(a: RawAudioTrack): ProbeAudio {
  const out: ProbeAudio = {
    codec: normalizeAudioCodec(a.codec, a.internalCodecId),
    channels: a.channels > 0 ? a.channels : 0,
    sampleRate: a.sampleRate > 0 ? a.sampleRate : 0,
    decodable: a.decodable,
  };
  const bitrate = pickBitrate(a.measuredBitrate, a.metadataBitrate);
  if (bitrate !== undefined) out.bitrate = bitrate;
  return out;
}

export function buildProbe(raw: RawProbe): Probe {
  return {
    container: containerFromFormatName(raw.formatName),
    sizeBytes: raw.sizeBytes,
    durationSec: Number.isFinite(raw.durationSec) && raw.durationSec > 0 ? raw.durationSec : 0,
    video: raw.video ? mapVideo(raw.video) : null,
    audio: raw.audio ? mapAudio(raw.audio) : null,
  };
}

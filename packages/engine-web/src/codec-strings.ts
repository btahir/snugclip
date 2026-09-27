// Codec names: Snugclip's ids ↔ mediabunny's ids, normalisation of whatever a file contains to
// ffprobe-style names (so web and CLI probes read the same), and bit depth from codec strings.
// Pure: no mediabunny runtime import, no browser globals.
import type { AudioCodecId, ContainerId, VideoCodecId } from '@snugclip/core';

/** mediabunny `VideoCodec` values we encode to. */
export type MbVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1';
/** mediabunny `AudioCodec` values we encode to. */
export type MbAudioCodec = 'aac' | 'opus';

export const VIDEO_CODEC_IDS: readonly VideoCodecId[] = ['h264', 'hevc', 'av1', 'vp9'];
export const AUDIO_CODEC_IDS: readonly AudioCodecId[] = ['aac', 'opus'];

const TO_MB_VIDEO: Record<VideoCodecId, MbVideoCodec> = { h264: 'avc', hevc: 'hevc', av1: 'av1', vp9: 'vp9' };

export function toMediabunnyVideoCodec(codec: VideoCodecId): MbVideoCodec {
  return TO_MB_VIDEO[codec];
}

export function fromMediabunnyVideoCodec(codec: string): VideoCodecId | null {
  for (const id of VIDEO_CODEC_IDS) if (TO_MB_VIDEO[id] === codec) return id;
  return null;
}

export function toMediabunnyAudioCodec(codec: AudioCodecId): MbAudioCodec {
  return codec;
}

const VIDEO_LABEL: Record<VideoCodecId, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };

/** Human encoder name for reports, e.g. "WebCodecs H.264" or "WebCodecs AV1 (low-latency)". */
export function encoderLabel(codec: VideoCodecId, latency: 'quality' | 'realtime' = 'quality'): string {
  return `WebCodecs ${VIDEO_LABEL[codec]}${latency === 'realtime' ? ' (low-latency)' : ''}`;
}

export function encoderNames(codecs: readonly VideoCodecId[]): Partial<Record<VideoCodecId, string>> {
  const out: Partial<Record<VideoCodecId, string>> = {};
  for (const c of codecs) out[c] = encoderLabel(c);
  return out;
}

/** The container a video codec goes into (PLAN §8.2: VP9 → WebM, everything else → MP4). */
export function containerForVideoCodec(codec: VideoCodecId): ContainerId {
  return codec === 'vp9' ? 'webm' : 'mp4';
}

export function mimeFor(container: ContainerId): string {
  return container === 'webm' ? 'video/webm' : 'video/mp4';
}

// --- Normalisation of source codecs --------------------------------------------------------

const MB_VIDEO_NORMAL: Record<string, string> = { avc: 'h264', hevc: 'hevc', vp9: 'vp9', av1: 'av1', vp8: 'vp8', prores: 'prores' };

/** Container-level codec ids (mediabunny `getInternalCodecId`) for codecs mediabunny can't name. */
const INTERNAL_VIDEO: Record<string, string> = {
  mp4v: 'mpeg4',
  'v_mpeg4/iso/asp': 'mpeg4',
  'v_mpeg4/iso/sp': 'mpeg4',
  'v_mpeg4/ms/v3': 'msmpeg4v3',
  xvid: 'mpeg4',
  divx: 'mpeg4',
  mp2v: 'mpeg2video',
  mpg2: 'mpeg2video',
  v_mpeg2: 'mpeg2video',
  v_mpeg1: 'mpeg1video',
  mp1v: 'mpeg1video',
  v_theora: 'theora',
  jpeg: 'mjpeg',
  mjpa: 'mjpeg',
  mjpb: 'mjpeg',
  v_mjpeg: 'mjpeg',
  'v_ms/vfw/fourcc': 'vfw',
  s263: 'h263',
  h263: 'h263',
  dvh1: 'hevc',
  dvhe: 'hevc',
  dva1: 'h264',
  dvav: 'h264',
};

/** MPEG-TS stream_type values (numbers) that aren't H.264/HEVC. */
const TS_STREAM_TYPES: Record<number, string> = { 0x01: 'mpeg1video', 0x02: 'mpeg2video', 0x10: 'mpeg4', 0x1b: 'h264', 0x24: 'hevc', 0xea: 'vc1' };

/**
 * ffprobe-style video codec name from mediabunny's codec (or, when mediabunny doesn't know the
 * codec, the container's own id). Unknown → 'unknown'.
 */
export function normalizeVideoCodec(mbCodec: string | null | undefined, internalId?: string | number | Uint8Array | null): string {
  if (mbCodec && MB_VIDEO_NORMAL[mbCodec]) return MB_VIDEO_NORMAL[mbCodec]!;
  if (typeof internalId === 'number') return TS_STREAM_TYPES[internalId] ?? 'unknown';
  if (typeof internalId === 'string' && internalId.trim()) {
    const key = internalId.trim().toLowerCase();
    return INTERNAL_VIDEO[key] ?? key.replace(/[^a-z0-9_.-]+/g, '_');
  }
  return mbCodec ? mbCodec : 'unknown';
}

const MB_AUDIO_NORMAL: Record<string, string> = {
  aac: 'aac',
  opus: 'opus',
  mp3: 'mp3',
  vorbis: 'vorbis',
  flac: 'flac',
  ac3: 'ac3',
  eac3: 'eac3',
  dts: 'dts',
  'pcm-s16': 'pcm_s16le',
  'pcm-s16be': 'pcm_s16be',
  'pcm-s24': 'pcm_s24le',
  'pcm-s24be': 'pcm_s24be',
  'pcm-s32': 'pcm_s32le',
  'pcm-s32be': 'pcm_s32be',
  'pcm-f32': 'pcm_f32le',
  'pcm-f32be': 'pcm_f32be',
  'pcm-f64': 'pcm_f64le',
  'pcm-f64be': 'pcm_f64be',
  'pcm-u8': 'pcm_u8',
  'pcm-s8': 'pcm_s8',
  ulaw: 'pcm_mulaw',
  alaw: 'pcm_alaw',
};

const INTERNAL_AUDIO: Record<string, string> = { a_ac3: 'ac3', 'a_eac3': 'eac3', a_dts: 'dts', a_truehd: 'truehd', mlpa: 'truehd', alac: 'alac', a_alac: 'alac', samr: 'amr_nb', sawb: 'amr_wb' };

export function normalizeAudioCodec(mbCodec: string | null | undefined, internalId?: string | number | Uint8Array | null): string {
  if (mbCodec && MB_AUDIO_NORMAL[mbCodec]) return MB_AUDIO_NORMAL[mbCodec]!;
  if (typeof internalId === 'string' && internalId.trim()) {
    const key = internalId.trim().toLowerCase();
    return INTERNAL_AUDIO[key] ?? key.replace(/[^a-z0-9_.-]+/g, '_');
  }
  return mbCodec ? mbCodec : 'unknown';
}

/**
 * Bit depth from a WebCodecs codec string, when the string encodes it:
 * avc1.PPCCLL (High 10 / 4:2:2 / 4:4:4 profiles → 10), hvc1/hev1 (Main 10 → 10, Main → 8),
 * vp09.PP.LL.DD and av01.P.LLT.DD (explicit DD), vp8 → 8.
 */
export function bitDepthFromCodecString(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const str = s.trim();
  const lower = str.toLowerCase();
  if (lower === 'vp8') return 8;
  let m = /^(?:avc1|avc3)\.([0-9a-f]{2})[0-9a-f]{4}$/i.exec(str);
  if (m) {
    const profile = parseInt(m[1]!, 16);
    return profile === 110 || profile === 122 || profile === 244 ? 10 : 8;
  }
  m = /^(?:hvc1|hev1|dvh1|dvhe)\.([a-c]?)(\d+)\./i.exec(str);
  if (m) {
    const profile = Number(m[2]);
    if (profile === 1) return 8;
    if (profile === 2) return 10;
    return undefined;
  }
  m = /^vp09\.\d{2}\.\d{2}\.(\d{2})/i.exec(str);
  if (m) return Number(m[1]);
  m = /^av01\.\d\.\d{2}[mh]\.(\d{2})/i.exec(str);
  if (m) return Number(m[1]);
  return undefined;
}

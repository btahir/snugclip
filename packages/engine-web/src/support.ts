// Browser support check for the friendly unsupported-browser screen (PLAN §8.4). Callable on the
// main thread or in a worker; loads nothing and encodes nothing.
import type { AudioCodecId, VideoCodecId } from '@snugclip/core';
import { getEncodableAudioCodecs, getEncodableVideoCodecs, Quality } from 'mediabunny';
import { fromMediabunnyVideoCodec } from './codec-strings.js';

export interface WebSupport {
  ok: boolean;
  /** Plain-words explanation when not ok. */
  reason?: string;
  /** Machine-readable reason when not ok. */
  code?: 'no-webcodecs' | 'no-video-encoder' | 'error';
  /** Encodable at 720p. */
  videoCodecs: VideoCodecId[];
  /**
   * Natively encodable. AAC may be missing (Firefox, Safari < 26); the engine then loads the
   * bundled AAC encoder from `aacEncoderUrl`, so this alone is not a reason to refuse.
   */
  audioCodecs: AudioCodecId[];
}

export interface SupportEnv {
  hasVideoEncoder: boolean;
  hasVideoDecoder: boolean;
  videoCodecs: VideoCodecId[];
  audioCodecs: AudioCodecId[];
}

const WORKS_IN = 'Snugclip works in Chrome, Edge, Firefox (desktop) and Safari 26+, or use the Snugclip CLI.';

export function summarizeSupport(env: SupportEnv): WebSupport {
  const base = { videoCodecs: env.videoCodecs, audioCodecs: env.audioCodecs };
  if (!env.hasVideoEncoder || !env.hasVideoDecoder) {
    return { ok: false, code: 'no-webcodecs', reason: `This browser can't encode video (it has no WebCodecs). ${WORKS_IN}`, ...base };
  }
  if (!env.videoCodecs.includes('h264') && !env.videoCodecs.includes('vp9')) {
    return { ok: false, code: 'no-video-encoder', reason: `This browser has no H.264 or VP9 video encoder. ${WORKS_IN}`, ...base };
  }
  return { ok: true, ...base };
}

export async function detectWebSupport(): Promise<WebSupport> {
  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasVideoDecoder = typeof VideoDecoder !== 'undefined';
  if (!hasVideoEncoder || !hasVideoDecoder) return summarizeSupport({ hasVideoEncoder, hasVideoDecoder, videoCodecs: [], audioCodecs: [] });
  try {
    const [v, a] = await Promise.all([
      getEncodableVideoCodecs(['avc', 'hevc', 'av1', 'vp9'], { width: 1280, height: 720, bitrate: 2_500_000, frameRate: 30 }),
      typeof AudioEncoder !== 'undefined'
        ? getEncodableAudioCodecs(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 128_000 }) })
        : Promise.resolve([]),
    ]);
    const videoCodecs = v.map(fromMediabunnyVideoCodec).filter((c): c is VideoCodecId => c !== null);
    const audioCodecs = a.filter((c): c is AudioCodecId => c === 'aac' || c === 'opus');
    return summarizeSupport({ hasVideoEncoder, hasVideoDecoder, videoCodecs, audioCodecs });
  } catch (e) {
    return {
      ok: false,
      code: 'error',
      reason: `Couldn't check this browser's video encoders (${e instanceof Error ? e.message : String(e)}). ${WORKS_IN}`,
      videoCodecs: [],
      audioCodecs: [],
    };
  }
}

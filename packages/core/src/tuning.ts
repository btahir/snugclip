// Every number the planner and fit loop depend on, in one place. PLAN.md is the authority
// for these values; change them here and rerun the golden tests.
import type { VideoCodec } from './types.js';

export const TUNING = {
  /** First-attempt aim: this fraction of the target. */
  goalFill: 0.97,
  /** An attempt that fits and uses at least this fraction of the target is accepted. */
  acceptFill: 0.9,
  /** After each overshoot the aim drops by this much (fraction of target)... */
  overshootBackoff: 0.03,
  /** ...but never below this fraction. */
  minGoalFill: 0.8,
  /** Maximum full encodes per file (calibration samples not counted). */
  maxAttempts: 6,

  /** Container overhead model: fixed bytes plus bytes per sample (video frame or audio frame). */
  overhead: {
    mp4: { fixed: 4096, perSample: 10 },
    webm: { fixed: 4096, perSample: 12 },
  },

  /** Bits-per-pixel-per-frame the planner aims for on H.264; other codecs scale by `codecEfficiency`. */
  targetBpp: 0.08,
  /** Below this bpp a rung looks broken; the planner drops a rung or refuses. */
  floorBpp: 0.04,
  /**
   * Above this bpp extra bits buy nothing visible; the planner caps the video bitrate here
   * (and at 1.2× the source video bitrate) and aims under the target instead of padding.
   */
  maxBpp: 0.25,
  /** Cap relative to the source video bitrate, when known. */
  maxSourceBitrateFactor: 1.2,
  /** Multiplier on the bpp targets per codec (lower = more efficient). */
  codecEfficiency: { h264: 1, hevc: 0.55, av1: 0.55, vp9: 0.65 } satisfies Record<VideoCodec, number>,

  /** Resolution rungs by shorter side (the "p" number). */
  rungs: [2160, 1440, 1080, 720, 540, 480, 360, 240],
  /** Frame-rate cap in `auto` mode. */
  maxAutoFps: 60,
  /** In `auto`, frame rates above this are halved (60→30, 50→25) before resolution drops. */
  fpsDropAbove: 30,

  /** Audio bitrate ladder in bits/s, highest first. */
  audioLadder: [128_000, 96_000, 64_000, 48_000, 32_000, 24_000],
  /** Audio gets at most this share of the total bitrate budget. */
  audioShare: 0.12,
  /** Mono sources are capped at this audio bitrate. */
  monoAudioCap: 64_000,

  /** VBV: peak = bitrate × maxrateFactor, buffer = bitrate × bufsizeSeconds. */
  maxrateFactor: 1.5,
  bufsizeSeconds: 2,

  /** Calibration: sample count and length. */
  calibration: {
    minDurationAuto: 12,
    minDurationOn: 6,
    sampleSec: { min: 2, max: 4, fraction: 0.04 },
    /** Measured/requested ratio clamp. */
    ratioClamp: [0.3, 3] as const,
  },

  /** Secant correction: slope clamp and per-step change clamp. */
  secant: { minSlope: 0.2, maxSlope: 2, maxStepDown: 0.4, maxStepUp: 2.5 },

  /** Quality: frames compared and the analysis resolution cap (shorter side). */
  quality: { frames: 10, maxShortSide: 720 },
  /** SSIM thresholds for the plain-words verdict. */
  verdict: { great: 0.95, softer: 0.9 },
} as const;

export type Tuning = typeof TUNING;

// Every number the planner and fit loop depend on (PLAN §4). Change them here, then rerun
// the goldens with `-u` after a reviewed PLAN change.
import type { VideoCodecId } from './types.js';

export const TUNING = {
  /** Codec efficiency relative to H.264 (PLAN §4: HEVC 0.60 because WebCodecs HEVC is hardware). */
  k: { h264: 1, vp9: 0.7, hevc: 0.6, av1: 0.55 } satisfies Record<VideoCodecId, number>,
  /** H.264-equivalent bits per pixel per frame. */
  bppGood: 0.08,
  bppFloor: 0.04,
  bppCeiling: 0.2,
  /** Cap relative to the source video bitrate. */
  sourceBitrateFactor: 1.1,

  overhead: {
    mp4: { fixed: 16384, perVideo: 12, perAudio: 6 },
    webm: { fixed: 8192, perVideo: 16, perAudio: 12 },
  },
  /** Audio bytes are padded by this factor (container interleaving, VBR drift). */
  audioPad: 1.03,
  audioLadder: { aac: [128, 96, 64, 48, 32, 24], opus: [96, 64, 48, 32, 24, 16] },
  /** Audio gets at most this share of the total kbps. */
  audioShare: 0.12,
  /** At or below this kbps audio goes mono. */
  monoAtOrBelow: { aac: 48, opus: 32 },
  /** Copy the source audio when its bitrate ≤ this × the chosen rung. */
  copyFactor: 1.1,

  /** Short-side rungs; the source (or cap) comes first, then every smaller rung. */
  rungs: [2160, 1440, 1080, 720, 540, 480, 360, 240],
  /** Frame rates above this are halved (or set to 30) before any resolution drop. */
  fpsDropAbove: 30.5,
  /** Extension: auto mode never starts above this fps (120 fps phone clips → 60). */
  maxAutoFps: 60,
  /** Extra fps steps at the lowest rung only. */
  bottomFpsSteps: [24, 20, 15],
  minFps: 15,
  keyframeSec: { A: 2, B: 5 },

  calibration: { minDuration: 15, len: { fraction: 0.04, min: 2, max: 4 }, ratioClamp: [0.5, 2] as const, vbr1Clamp: [0.5, 1.25] as const },
  complexity: { low: 0.97, medium: 0.93 },
  /** Rung probe during calibration: when the sample SSIM is below this. */
  rungProbeBelow: 0.9,

  secant: { slopeClamp: [0.5, 1.5] as const },
  /** Margin step after each overshoot, and its cap. */
  marginStep: 0.02,
  marginCap: 0.12,
  rescueMargin: 0.1,
  acceptFill: 0.9,
  /** Floor detection: slope below this on an overshoot, or measured > factor × requested below floor bpp. */
  floorSlope: 0.3,
  floorOvershootFactor: 1.5,
  measuredMinPad: 1.05,
  /**
   * Extension (not in PLAN): simple content (screen recordings) leaves most of the budget unused
   * at the ladder's rung. When an attempt fits, lands under acceptFill·T and the encoder used less
   * than `usedBelow` of the requested bitrate, jump up to the largest rung whose estimated bitrate
   * (measured × pixel-rate ratio ^ pixelExponent) still fits the budget.
   */
  rungUp: { usedBelow: 0.5, pixelExponent: 0.9 },

  /**
   * Native (WebCodecs) AAC allowlist. On macOS 27, Chromium's AudioEncoder AAC at low bitrates
   * (32k mono/stereo at 44.1/48 kHz, 48k stereo and 64k stereo at 44.1 kHz) aborts the GPU process,
   * which takes down every later encode in the tab (reproduced 2026-09-27 in headless Chrome 154 and
   * Chromium 152; isConfigSupported still says "supported"). 96 kbps and above were fine in every
   * channel/rate combination. Below this, engines must use the WASM AAC encoder or not use AAC.
   */
  nativeAacSafe: { minBitrate: 96_000, channels: [1, 2] as readonly number[], sampleRates: [44100, 48000] as readonly number[] },
  maxAttempts: { twoPass: 3, onePass: 4, limit: 8 },
  stallMs: { web: 20_000, ffmpeg: 60_000 },

  quality: { frames: 10, maxEvalShortSide: 720 },
  verdict: { great: { mean: 0.95, min: 0.9 }, softer: { mean: 0.88, min: 0.8 } },
  /** Progress weights. */
  progress: { calibration: 0.1, checking: 0.04 },
} as const;

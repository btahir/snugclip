// Quality metrics on 8-bit luma frames. Both engines decode matched frames to gray bytes at
// the same size and hand them here, so the web app and CLI score quality identically.
import { TUNING } from './tuning.js';
import type { QualityMetrics, QualityReport, QualityVerdict } from './types.js';

const K1 = 0.01;
const K2 = 0.03;
const L = 255;
const C1 = (K1 * L) ** 2;
const C2 = (K2 * L) ** 2;
const RADIUS = 5; // 11-tap window
const SIGMA = 1.5;

const KERNEL: Float64Array = (() => {
  const k = new Float64Array(2 * RADIUS + 1);
  let sum = 0;
  for (let i = -RADIUS; i <= RADIUS; i++) {
    const v = Math.exp(-(i * i) / (2 * SIGMA * SIGMA));
    k[i + RADIUS] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
})();

/** Separable Gaussian blur of `src` (w×h) over the "valid" region; returns (w-10)×(h-10). */
function blurValid(src: Float64Array, w: number, h: number): Float64Array {
  const ow = w - 2 * RADIUS;
  const oh = h - 2 * RADIUS;
  const tmp = new Float64Array(ow * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < ow; x++) {
      let s = 0;
      for (let k = 0; k <= 2 * RADIUS; k++) s += src[row + x + k]! * KERNEL[k]!;
      tmp[y * ow + x] = s;
    }
  }
  const out = new Float64Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let s = 0;
      for (let k = 0; k <= 2 * RADIUS; k++) s += tmp[(y + k) * ow + x]! * KERNEL[k]!;
      out[y * ow + x] = s;
    }
  }
  return out;
}

/**
 * Mean SSIM (Wang et al. 2004: 11×11 Gaussian window, σ = 1.5, K1 = 0.01, K2 = 0.03) between two
 * 8-bit gray frames of identical size. Returns 1 for identical frames.
 */
export function ssim(a: Uint8Array, b: Uint8Array, width: number, height: number): number {
  if (a.length < width * height || b.length < width * height) throw new RangeError('frame buffers are smaller than width×height');
  if (width <= 2 * RADIUS || height <= 2 * RADIUS) return a.every((v, i) => v === b[i]) ? 1 : 0;
  const n = width * height;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const xx = new Float64Array(n);
  const yy = new Float64Array(n);
  const xy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    x[i] = av;
    y[i] = bv;
    xx[i] = av * av;
    yy[i] = bv * bv;
    xy[i] = av * bv;
  }
  const mx = blurValid(x, width, height);
  const my = blurValid(y, width, height);
  const sxx = blurValid(xx, width, height);
  const syy = blurValid(yy, width, height);
  const sxy = blurValid(xy, width, height);
  let total = 0;
  for (let i = 0; i < mx.length; i++) {
    const ux = mx[i]!;
    const uy = my[i]!;
    const vx = sxx[i]! - ux * ux;
    const vy = syy[i]! - uy * uy;
    const cxy = sxy[i]! - ux * uy;
    total += ((2 * ux * uy + C1) * (2 * cxy + C2)) / ((ux * ux + uy * uy + C1) * (vx + vy + C2));
  }
  return total / mx.length;
}

/** PSNR in dB between two 8-bit gray frames; 100 when identical. */
export function psnr(a: Uint8Array, b: Uint8Array, width: number, height: number): number {
  const n = width * height;
  let se = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    se += d * d;
  }
  if (se === 0) return 100;
  const mse = se / n;
  return Math.min(100, 10 * Math.log10((L * L) / mse));
}

/** Analysis size for quality checks: the output size, scaled so the shorter side is ≤ 720, even. */
export function analysisSize(width: number, height: number, maxShort: number = TUNING.quality.maxShortSide): { width: number; height: number } {
  const short = Math.min(width, height);
  const s = short > maxShort ? maxShort / short : 1;
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Timestamps (seconds, relative to the output start) of the frames to compare. */
export function sampleTimes(durationSec: number, count: number = TUNING.quality.frames): number[] {
  const n = Math.max(1, Math.floor(count));
  const out: number[] = [];
  // Evenly spaced, avoiding the very first and last frames (fades, encoder warm-up).
  for (let i = 0; i < n; i++) out.push(Math.round(((durationSec * (i + 0.5)) / n) * 1000) / 1000);
  return out;
}

export interface FramePair {
  source: Uint8Array;
  output: Uint8Array;
}

/** Scores matched frame pairs (all at `width`×`height`). */
export function compareFrames(pairs: FramePair[], width: number, height: number): QualityMetrics {
  if (pairs.length === 0) throw new RangeError('no frames to compare');
  let sum = 0;
  let min = 1;
  let psum = 0;
  for (const p of pairs) {
    const s = ssim(p.source, p.output, width, height);
    sum += s;
    min = Math.min(min, s);
    psum += psnr(p.source, p.output, width, height);
  }
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return {
    ssimMean: r4(sum / pairs.length),
    ssimMin: r4(min),
    psnrMean: Math.round((psum / pairs.length) * 100) / 100,
    frames: pairs.length,
    width,
    height,
  };
}

const LABELS: Record<QualityVerdict, string> = {
  great: 'Looks great',
  softer: 'Softer, still clear',
  soft: 'Noticeably soft',
};

/** Maps mean SSIM to the plain-words badge. */
export function qualityVerdict(ssimMean: number): { verdict: QualityVerdict; label: string } {
  const verdict: QualityVerdict = ssimMean >= TUNING.verdict.great ? 'great' : ssimMean >= TUNING.verdict.softer ? 'softer' : 'soft';
  return { verdict, label: LABELS[verdict] };
}

export function toQualityReport(m: QualityMetrics): QualityReport {
  return { ...m, ...qualityVerdict(m.ssimMean) };
}

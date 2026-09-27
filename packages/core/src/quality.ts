// Quality metrics (PLAN §5). Engines hand over matched RGBA frames scaled to the same eval
// short side; the core computes SSIM (ssim.js, default "weber" variant) and luma PSNR, so the
// web app and the CLI score quality identically.
import { ssim as ssimJs } from 'ssim.js';
import { TUNING } from './tuning.js';
import type { LumaFrame, Probe, QualityReport } from './types.js';

export const SSIM_ALGORITHM = 'ssim.js weber (default options)';

/** Eval resolution: min(720, source display short side). */
export function evalShortSide(probe: Probe): number {
  const v = probe.video;
  if (!v) return TUNING.quality.maxEvalShortSide;
  return Math.min(TUNING.quality.maxEvalShortSide, Math.min(v.displayWidth, v.displayHeight));
}

/** Output-relative sample times t_i = D·(i + 0.5)/n; add the trim start for the source. */
export function qualityTimes(durationSec: number, n: number = TUNING.quality.frames): number[] {
  const count = Math.max(1, Math.floor(n));
  return Array.from({ length: count }, (_, i) => Math.round(((durationSec * (i + 0.5)) / count) * 1000) / 1000);
}

/** BT.709 luma from RGBA (integer maths, 0..255). */
export function toLuma(f: LumaFrame): Uint8Array {
  const n = f.width * f.height;
  const out = new Uint8Array(n);
  const d = f.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (d[j]! * 2126 + d[j + 1]! * 7152 + d[j + 2]! * 722 + 5000) / 10000;
  return out;
}

/** Crops an RGBA frame to w×h from the top-left (engines may round the long side differently by 2 px). */
function crop(f: LumaFrame, w: number, h: number): LumaFrame {
  if (f.width === w && f.height === h) return f;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(f.data.subarray(y * f.width * 4, y * f.width * 4 + w * 4), y * w * 4);
  return { width: w, height: h, data };
}

export function psnrLuma(a: Uint8Array, b: Uint8Array): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    se += d * d;
  }
  if (se === 0) return 100;
  return Math.min(100, 10 * Math.log10((255 * 255) / (se / a.length)));
}

export function ssimPair(a: LumaFrame, b: LumaFrame): number {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  return ssimJs(crop(a, w, h), crop(b, w, h)).mssim;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scores [source, output] frame pairs. */
export function quality(pairs: Array<[LumaFrame, LumaFrame]>): Omit<QualityReport, 'verdict' | 'label'> {
  if (pairs.length === 0) throw new RangeError('quality() needs at least one frame pair');
  const ssims: number[] = [];
  const psnrs: number[] = [];
  let evalSide = Infinity;
  for (const [src, out] of pairs) {
    const w = Math.min(src.width, out.width);
    const h = Math.min(src.height, out.height);
    evalSide = Math.min(evalSide, Math.min(w, h));
    const a = crop(src, w, h);
    const b = crop(out, w, h);
    ssims.push(ssimJs(a, b).mssim);
    psnrs.push(psnrLuma(toLuma(a), toLuma(b)));
  }
  return {
    frames: pairs.length,
    evalShortSide: evalSide,
    ssimMean: r4(ssims.reduce((s, x) => s + x, 0) / ssims.length),
    ssimMin: r4(Math.min(...ssims)),
    psnrMean: r2(psnrs.reduce((s, x) => s + x, 0) / psnrs.length),
    psnrMin: r2(Math.min(...psnrs)),
    algorithm: SSIM_ALGORITHM,
  };
}

const LABELS = { great: 'Looks great', softer: 'Softer, still clear', soft: 'Noticeably soft' } as const;

/** Plain-words badge (PLAN §5). */
export function verdict(ssimMean: number, ssimMin: number): Pick<QualityReport, 'verdict' | 'label'> {
  const t = TUNING.verdict;
  const v = ssimMean >= t.great.mean && ssimMin >= t.great.min ? 'great' : ssimMean >= t.softer.mean && ssimMin >= t.softer.min ? 'softer' : 'soft';
  return { verdict: v, label: LABELS[v] };
}

/** Complexity from calibration-sample SSIM (PLAN §4.7). */
export function complexityFrom(ssimMean: number): 'low' | 'medium' | 'high' {
  return ssimMean >= TUNING.complexity.low ? 'low' : ssimMean >= TUNING.complexity.medium ? 'medium' : 'high';
}

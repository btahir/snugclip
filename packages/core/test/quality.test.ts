import { describe, expect, it } from 'vitest';
import { complexityFrom, evalShortSide, psnrLuma, quality, qualityTimes, toLuma, verdict, type LumaFrame } from '../src/index.js';
import { makeProbe } from './fake-engine.js';

function frame(w: number, h: number, f: (x: number, y: number) => number): LumaFrame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const g = f(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}
const pattern = (x: number, y: number) => (x * 7 + y * 13 + ((x * y) % 31)) % 256;

describe('quality', () => {
  it('identical frames score 1 / 100 dB', () => {
    const a = frame(64, 36, pattern);
    expect(quality([[a, a]])).toMatchObject({ frames: 1, evalShortSide: 36, ssimMean: 1, ssimMin: 1, psnrMean: 100, psnrMin: 100 });
  });
  it('distortion lowers SSIM and PSNR; min ≤ mean', () => {
    const a = frame(128, 72, pattern);
    const mild = frame(128, 72, (x, y) => Math.min(255, pattern(x, y) + ((x + y) % 3)));
    const heavy = frame(128, 72, (x, y) => (pattern(x, y) + ((x * 7919 + y * 104729) % 97)) % 256);
    const q = quality([
      [a, mild],
      [a, heavy],
    ]);
    expect(q.ssimMin).toBeLessThan(q.ssimMean);
    expect(q.psnrMin).toBeLessThan(q.psnrMean);
    expect(quality([[a, mild]]).ssimMean).toBeGreaterThan(quality([[a, heavy]]).ssimMean);
  });
  it('crops frames that differ by a couple of pixels', () => {
    const a = frame(66, 36, pattern);
    const b = frame(64, 36, pattern);
    expect(quality([[a, b]]).ssimMean).toBe(1);
  });
  it('BT.709 luma and PSNR', () => {
    expect([...toLuma({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) })]).toEqual([54]);
    expect(psnrLuma(new Uint8Array([10, 10]), new Uint8Array([20, 20]))).toBeCloseTo(28.13, 2);
  });
  it('verdict needs both mean and min', () => {
    expect(verdict(0.97, 0.93)).toEqual({ verdict: 'great', label: 'Looks great' });
    expect(verdict(0.97, 0.85)).toEqual({ verdict: 'softer', label: 'Softer, still clear' });
    expect(verdict(0.9, 0.82)).toEqual({ verdict: 'softer', label: 'Softer, still clear' });
    expect(verdict(0.9, 0.7)).toEqual({ verdict: 'soft', label: 'Noticeably soft' });
    expect(verdict(0.8, 0.8)).toEqual({ verdict: 'soft', label: 'Noticeably soft' });
  });
  it('eval side, sample times, complexity', () => {
    expect(evalShortSide(makeProbe({ width: 3840, height: 2160 }))).toBe(720);
    expect(evalShortSide(makeProbe({ width: 640, height: 360 }))).toBe(360);
    expect(qualityTimes(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
    expect([complexityFrom(0.98), complexityFrom(0.95), complexityFrom(0.8)]).toEqual(['low', 'medium', 'high']);
  });
});

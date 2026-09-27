import { describe, expect, it } from 'vitest';
import { NATIVE_AAC_PRIMING_SAMPLES, planAacRetime } from '../src/aac-timing.js';
import { frameSlotMapper, needsFrameRateConversion } from '../src/conversion-options.js';

const run = (outFps: number, srcFps: number, D: number, ts?: number[]) => {
  const m = frameSlotMapper(outFps, srcFps, D);
  const src = ts ?? Array.from({ length: Math.round(D * srcFps) }, (_, i) => i / srcFps);
  return src.map((t) => m(t));
};

describe('nearest-neighbour frame-rate conversion (V2)', () => {
  it('30 → 15 keeps every other frame, aligned (frame k/15 = source frame 2k)', () => {
    const r = run(15, 30, 1);
    expect(r.filter((x) => x.length).length).toBe(15);
    expect(r[0]).toEqual([0]);
    expect(r[1]).toEqual([]);
    expect(r[2]).toEqual([1]);
  });
  it('30 → 24 picks the nearest source frame for every slot and fills all slots exactly once', () => {
    const r = run(24, 30, 5);
    const slots = r.flat();
    expect(slots).toEqual(Array.from({ length: 120 }, (_, k) => k));
    // nearest: slot k's source frame i minimises |i/30 − k/24|
    r.forEach((ks, i) => ks.forEach((k) => expect(Math.abs(i / 30 - k / 24)).toBeLessThanOrEqual(1 / 60 + 1e-9)));
  });
  it('60 → 30, 29.97 → 29.97 is not a conversion; webm-rounded timestamps still map nearest', () => {
    expect(run(30, 60, 1).flat()).toEqual(Array.from({ length: 30 }, (_, k) => k));
    expect(needsFrameRateConversion(29.97, 29.97)).toBe(false);
    expect(needsFrameRateConversion(15, 30)).toBe(true);
    expect(needsFrameRateConversion(15, undefined)).toBe(false);
    const ms = Array.from({ length: 30 }, (_, i) => Math.round((i / 30) * 1000) / 1000); // 0, 0.033, 0.067 …
    const r = run(15, 30, 1, ms);
    expect(r.map((x) => x.length)).toEqual(ms.map((_, i) => (i % 2 === 0 ? 1 : 0)));
  });
  it('VFR gaps are filled by the next frame; nothing past the end', () => {
    expect(run(10, 30, 1, [0, 0.5, 0.95])).toEqual([[0], [1, 2, 3, 4, 5], [6, 7, 8, 9]]);
  });
});

describe('native AAC priming re-time (V1)', () => {
  const pk = (n: number, sr = 48000) => Array.from({ length: n }, (_, i) => ({ timestamp: (i * 1024) / sr, duration: 1024 / sr }));
  it('shifts by 2112 samples and drops packets past the video end', () => {
    // F06: 10 s video, 472 native AAC packets (priming + 468.75 content frames).
    const r = planAacRetime(pk(472), 48000, 10);
    expect(r.shiftSec).toBeCloseTo(NATIVE_AAC_PRIMING_SAMPLES / 48000, 9);
    expect(r.changed).toBe(true);
    const lastEnd = ((r.keep - 1) * 1024 + 1024) / 48000 - r.shiftSec;
    expect(lastEnd).toBeLessThanOrEqual(10.001);
    expect(10 - lastEnd).toBeLessThan(1024 / 48000);
  });
  it('trim case: 5.5 s video at 44.1 kHz', () => {
    const r = planAacRetime(pk(Math.ceil((5.5 * 44100 + 2112) / 1024) + 1, 44100), 44100, 5.5);
    const lastEnd = (r.keep * 1024) / 44100 - r.shiftSec;
    expect(lastEnd).toBeLessThanOrEqual(5.501);
    expect(5.5 - lastEnd).toBeLessThan(1024 / 44100);
  });
  it('no shift when the encoder already signalled priming (negative first timestamp); no-op when nothing changes', () => {
    const signalled = pk(10).map((p) => ({ ...p, timestamp: p.timestamp - 0.044 }));
    expect(planAacRetime(signalled, 48000, 1).shiftSec).toBe(0);
    expect(planAacRetime([], 48000, 1)).toEqual({ shiftSec: 0, keep: 0, changed: false });
    const neg = pk(40).map((p) => ({ ...p, timestamp: p.timestamp - 0.044 }));
    expect(planAacRetime(neg, 48000, 1).changed).toBe(false);
  });
});

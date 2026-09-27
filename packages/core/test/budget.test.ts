// A3: budget and audio maths; A4: impossible targets.
import { describe, expect, it } from 'vitest';
import { MB, TUNING, bppThresholds, chooseAudio, emailRawMax, minimumBytes, normalizeOptions, overheadBytes, plan, type Probe } from '../src/index.js';
import { makeProbe, testCaps, webCaps } from './fake-engine.js';

const caps = testCaps();

describe('overhead', () => {
  it('mp4: 16384 + 12·Nv + 6·Na; webm: 8192 + 16·Nv + 12·Na', () => {
    expect(overheadBytes('mp4', 10, 30, { codec: 'aac', sampleRate: 48000 })).toBe(16384 + 12 * 300 + 6 * Math.ceil((10 * 48000) / 1024));
    expect(overheadBytes('webm', 10, 30, { codec: 'opus', sampleRate: 48000 })).toBe(8192 + 16 * 300 + 12 * 500);
    expect(overheadBytes('mp4', 10, 30, null)).toBe(16384 + 3600);
  });
});

describe('audio selection', () => {
  const aac = (bitrate: number, channels = 2): Probe => makeProbe({ audio: { codec: 'aac', channels, sampleRate: 48000, bitrate, decodable: true } });
  const pick = (btot: number, probe = aac(320_000), codec: 'aac' | 'opus' = 'aac') => chooseAudio(probe, normalizeOptions({}), codec, 60, btot, caps, undefined);
  it.each([
    [50, 24, 1],
    [100, 24, 1],
    [200, 24, 1],
    [400, 48, 1],
    [1000, 96, 2],
    [2000, 128, 2],
    [10000, 128, 2],
  ])('AAC at Btot %d kbps → %d kbps, %d ch', (btot, kbps, ch) => {
    const a = pick(btot);
    expect(a).toMatchObject({ mode: 'encode', codec: 'aac', bitrate: kbps * 1000, channels: ch });
    expect(a.bytes).toBe(Math.ceil(((kbps * 1000 * 60) / 8) * 1.03));
  });
  it.each([
    [50, 16, 1],
    [400, 48, 2],
    [2000, 96, 2],
  ])('Opus at Btot %d kbps → %d kbps, %d ch', (btot, kbps, ch) => {
    const probe = makeProbe({ audio: { codec: 'opus', channels: 2, sampleRate: 48000, bitrate: 320_000, decodable: true } });
    expect(pick(btot, probe, 'opus')).toMatchObject({ bitrate: kbps * 1000, channels: ch, sampleRate: 48000 });
  });
  it('mono source stays mono; never above the source bitrate rung', () => {
    expect(pick(10000, aac(320_000, 1))).toMatchObject({ channels: 1 });
    // source 100 kbps: rungAtOrAbove(100) = 128 → abr capped at 128 → copy (100 ≤ 1.1·128)
    expect(pick(10000, aac(100_000))).toMatchObject({ mode: 'copy', bitrate: 100_000 });
    // source 60 kbps non-AAC (mp3): rungAtOrAbove(60) = 64
    const mp3 = makeProbe({ audio: { codec: 'mp3', channels: 2, sampleRate: 44100, bitrate: 60_000, decodable: true } });
    expect(pick(10000, mp3)).toMatchObject({ mode: 'encode', bitrate: 64_000, sampleRate: 44100 });
  });
  it('copy vs encode, including trim with audioCopyWithTrim true/false', () => {
    const p = aac(128_000);
    const trim = { startSec: 1, endSec: 20 };
    expect(chooseAudio(p, normalizeOptions({}), 'aac', 60, 2000, caps, undefined).mode).toBe('copy');
    expect(chooseAudio(p, normalizeOptions({}), 'aac', 60, 2000, testCaps({ audioCopyWithTrim: true }), trim).mode).toBe('copy');
    expect(chooseAudio(p, normalizeOptions({}), 'aac', 60, 2000, testCaps({ audioCopyWithTrim: false }), trim).mode).toBe('encode');
    // source bitrate above 1.1 × abr → encode
    expect(chooseAudio(aac(192_000), normalizeOptions({}), 'aac', 60, 400, caps, undefined)).toMatchObject({ mode: 'encode', bitrate: 48_000 });
    // AAC into WebM (opus) is never copied
    expect(chooseAudio(p, normalizeOptions({}), 'opus', 60, 2000, caps, undefined).mode).toBe('encode');
    // mute / no audio
    expect(chooseAudio(p, normalizeOptions({ mute: true }), 'aac', 60, 2000, caps, undefined)).toEqual({ mode: 'none', bytes: 0 });
  });
  it('emailRawMax', () => {
    // PLAN pins floor((limit − 64000)/1.37); 25 MB → 18,201,459.85 → 18,201,459 (PLAN text rounds to …460).
    expect(emailRawMax(25e6)).toBe(18_201_459);
    expect(emailRawMax(20e6)).toBe(14_551_824);
  });
});

describe('impossible targets (A4)', () => {
  const formula = (p: Probe, codec: 'h264' | 'vp9', D: number, m: number, keepFps = false) => {
    const container = codec === 'vp9' ? 'webm' : 'mp4';
    const v = p.video!;
    const short = Math.min(v.displayWidth, v.displayHeight);
    const s = Math.min(240, short);
    const long = Math.max(v.displayWidth, v.displayHeight);
    const w0 = v.displayWidth >= v.displayHeight ? Math.round((long * s) / short / 2) * 2 : s;
    const h0 = v.displayWidth >= v.displayHeight ? s : Math.round((long * s) / short / 2) * 2;
    const f = v.fps > 30.5 ? (v.fps / 2 <= 30.5 ? v.fps / 2 : 30) : v.fps;
    const fmin = keepFps ? v.fps : Math.min(f, 15);
    const ac = container === 'webm' ? 'opus' : 'aac';
    const aMin = p.audio ? Math.ceil((((ac === 'aac' ? 24000 : 16000) * D) / 8) * 1.03) : 0;
    const O = overheadBytes(container, D, fmin, p.audio ? { codec: ac, sampleRate: 48000 } : null);
    return Math.ceil((O + aMin + (bppThresholds(codec).floor * w0 * h0 * fmin * D) / 8) / (1 - m));
  };
  const cases: [Parameters<typeof makeProbe>[0], 'h264' | 'vp9', number][] = [];
  for (const d of [300, 600, 1800, 3600]) {
    cases.push([{ durationSec: d }, 'h264', 1 * MB]);
    cases.push([{ durationSec: d, fps: 60 }, 'h264', 2 * MB]);
    cases.push([{ durationSec: d, width: 1080, height: 1920 }, 'vp9', 1 * MB]);
    cases.push([{ durationSec: d, audio: null }, 'h264', 0.5 * MB]);
    cases.push([{ durationSec: d, width: 3840, height: 2160, fps: 60 }, 'vp9', 1.5 * MB]);
  }
  it.each(cases.map((c, i) => [i, ...c] as const))('#%d infeasible with minimumBytes = formula', (_i, p, codec, T) => {
    const probe = makeProbe(p);
    const c = codec === 'vp9' ? testCaps({ videoCodecs: ['vp9'] }) : caps;
    const r = plan(probe, { bytes: T, label: 'x' }, { codec }, c);
    expect(r.feasible).toBe(false);
    expect(r.video).toBeNull();
    expect(r.minimumBytes).toBe(formula(probe, codec, probe.durationSec, c.initialMargin));
    expect(minimumBytes(probe, { codec }, c)).toBe(r.minimumBytes);
  });
  it('T = minimumBytes is feasible; one byte less is not', () => {
    const probe = makeProbe({ durationSec: 900 });
    const min = plan(probe, { bytes: 1 * MB, label: 'x' }, {}, caps).minimumBytes;
    expect(plan(probe, { bytes: min, label: 'x' }, {}, caps).feasible).toBe(true);
    expect(plan(probe, { bytes: min - 1, label: 'x' }, {}, caps).feasible).toBe(false);
  });
  it('web margin (0.04) raises the minimum', () => {
    const probe = makeProbe({ durationSec: 900 });
    expect(minimumBytes(probe, {}, webCaps())).toBeGreaterThan(minimumBytes(probe, {}, caps));
  });
  it('keyframe interval: 2 s tier A, 5 s tier B', () => {
    const a = plan(makeProbe({ durationSec: 30 }), { bytes: 25 * MB, label: 'x' }, {}, caps);
    expect(a.video).toMatchObject({ bppTier: 'A', keyframeIntervalSec: 2 });
    const b = plan(makeProbe({ durationSec: 3600 }), { bytes: 50 * MB, label: 'x' }, {}, caps);
    expect(b.video).toMatchObject({ bppTier: 'B', keyframeIntervalSec: 5 });
    expect(b.warnings.map((w) => w.code)).toContain('tight-budget');
  });
  it('quality ceiling and source-bitrate caps', () => {
    const a = plan(makeProbe({ durationSec: 8 }), { bytes: 100 * MB, label: 'x' }, {}, caps);
    expect(a.video).toMatchObject({ capped: 'quality-ceiling', bitrate: Math.floor(TUNING.bppCeiling * 1920 * 1080 * 30) });
    const s = plan(makeProbe({ durationSec: 8, videoBitrate: 4_000_000 }), { bytes: 100 * MB, label: 'x' }, {}, caps);
    expect(s.video).toMatchObject({ capped: 'source-bitrate', bitrate: 4_400_000 });
  });
});

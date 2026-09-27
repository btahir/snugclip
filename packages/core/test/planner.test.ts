import { describe, expect, it } from 'vitest';
import {
  ALL_CAPABILITIES,
  MB,
  bppFor,
  buildLadder,
  dimsForShortSide,
  plan,
  resolveCodec,
  resolveOptions,
  type Capabilities,
  type Probe,
} from '../src/index.js';
import { makeProbe } from './fake-engine.js';

describe('dimsForShortSide', () => {
  it('keeps aspect, never upscales, rounds to even', () => {
    expect(dimsForShortSide(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(dimsForShortSide(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(dimsForShortSide(1920, 1080, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(dimsForShortSide(1920, 1080, 540)).toEqual({ width: 960, height: 540 });
    expect(dimsForShortSide(1920, 1080, 480)).toEqual({ width: 854, height: 480 });
    expect(dimsForShortSide(1918, 1078, 1080)).toEqual({ width: 1918, height: 1078 });
    expect(dimsForShortSide(641, 361, 1080)).toEqual({ width: 642, height: 362 });
  });
});

describe('ladder', () => {
  it('drops 60→30 fps before any resolution step in auto', () => {
    const l = buildLadder(makeProbe({ fps: 60 }), resolveOptions({}));
    expect(l.slice(0, 3)).toEqual([
      { width: 1920, height: 1080, fps: 60 },
      { width: 1920, height: 1080, fps: 30 },
      { width: 1280, height: 720, fps: 30 },
    ]);
    expect(l.at(-1)).toEqual({ width: 426, height: 240, fps: 30 });
  });
  it('keeps fps with fps=keep and caps with a number', () => {
    expect(buildLadder(makeProbe({ fps: 60 }), resolveOptions({ fps: 'keep' })).every((r) => r.fps === 60)).toBe(true);
    expect(buildLadder(makeProbe({ fps: 60 }), resolveOptions({ fps: 24 })).every((r) => r.fps === 24)).toBe(true);
  });
  it('halves 59.94 and 50', () => {
    expect(buildLadder(makeProbe({ fps: 59.94 }), resolveOptions({}))[1]!.fps).toBe(29.97);
    expect(buildLadder(makeProbe({ fps: 50 }), resolveOptions({}))[1]!.fps).toBe(25);
  });
  it('caps 120 fps at 60 in auto', () => {
    expect(buildLadder(makeProbe({ fps: 120 }), resolveOptions({}))[0]!.fps).toBe(60);
  });
  it('honours maxHeight as the shorter side, portrait too', () => {
    const p = makeProbe({ width: 1080, height: 1920 });
    const l = buildLadder(p, resolveOptions({ maxHeight: 720 }));
    expect(l[0]).toEqual({ width: 720, height: 1280, fps: 30 });
  });
  it('starts at 4K and allows above 1080p', () => {
    const l = buildLadder(makeProbe({ width: 3840, height: 2160 }), resolveOptions({}));
    expect(l.map((r) => r.height)).toEqual([2160, 1440, 1080, 720, 540, 480, 360, 240]);
  });
});

describe('codec resolution', () => {
  const caps = (video: Capabilities['video']): Capabilities => ({ ...ALL_CAPABILITIES, video });
  it('compatible → h264 mp4', () => {
    expect(resolveCodec('compatible', ALL_CAPABILITIES)).toMatchObject({ codec: 'h264', container: 'mp4' });
  });
  it('smaller → av1, then hevc', () => {
    expect(resolveCodec('smaller', ALL_CAPABILITIES).codec).toBe('av1');
    expect(resolveCodec('smaller', caps(['h264', 'hevc'])).codec).toBe('hevc');
  });
  it('compatible without h264 → vp9 webm with a warning', () => {
    const r = resolveCodec('compatible', caps(['vp9', 'av1']));
    expect(r).toMatchObject({ codec: 'vp9', container: 'webm' });
    expect(r.warnings.length).toBe(1);
  });
  it('explicit missing codec throws ENCODER_MISSING', () => {
    expect(() => resolveCodec('hevc', caps(['h264']))).toThrow(/HEVC/);
  });
});

describe('plan', () => {
  it('passes through a file already under the target', () => {
    const p = plan({ probe: makeProbe({ sizeBytes: 5 * MB }), target: { bytes: 10 * MB } });
    expect(p.mode).toBe('passthrough');
    expect(p.spec).toBeNull();
  });
  it('re-encodes an under-target file when asked, or when trimming/muting', () => {
    const probe = makeProbe({ sizeBytes: 5 * MB, durationSec: 10 });
    expect(plan({ probe, target: { bytes: 10 * MB }, options: { reencode: true } }).mode).toBe('encode');
    expect(plan({ probe, target: { bytes: 10 * MB }, options: { mute: true } }).mode).toBe('encode');
    expect(plan({ probe, target: { bytes: 10 * MB }, options: { trim: { start: 1, end: 5 } } }).mode).toBe('encode');
    expect(plan({ probe, target: { bytes: 10 * MB }, options: { maxHeight: 720 } }).mode).toBe('encode');
    // A trim that covers the whole clip is no trim.
    expect(plan({ probe, target: { bytes: 10 * MB }, options: { trim: { start: 0, end: 10 } } }).mode).toBe('passthrough');
  });
  it('1080p30 60 s → 10 MB picks a rung meeting the H.264 bpp target', () => {
    const p = plan({ probe: makeProbe(), target: { bytes: 10 * MB } });
    expect(p.mode).toBe('encode');
    const v = p.spec!.video!;
    expect(v.bitrate / (v.width * v.height * v.fps)).toBeGreaterThanOrEqual(bppFor('h264').target);
    expect(v.width).toBeLessThan(1920);
    const total = p.budget.videoBytes + p.budget.audioBytes + p.budget.overheadBytes;
    expect(total).toBeLessThanOrEqual(p.budget.goalBytes);
    expect(p.budget.goalBytes).toBeLessThan(10 * MB);
  });
  it('never upscales even with a huge budget', () => {
    const p = plan({ probe: makeProbe({ width: 640, height: 360, sizeBytes: 500 * MB }), target: { bytes: 400 * MB } });
    expect(p.spec!.video!.width).toBe(640);
    expect(p.spec!.video!.height).toBe(360);
  });
  it('keeps 4K when the budget supports it', () => {
    const p = plan({ probe: makeProbe({ width: 3840, height: 2160, durationSec: 8, sizeBytes: 60 * MB }), target: { bytes: 50 * MB } });
    expect(p.spec!.video!.height).toBe(2160);
  });
  it('refuses impossible targets with a minimum size that is itself feasible', () => {
    const probe = makeProbe({ durationSec: 600 });
    const p = plan({ probe, target: { bytes: 2 * MB } });
    expect(p.mode).toBe('impossible');
    expect(p.minimumBytes).toBeGreaterThan(2 * MB);
    const atMin = plan({ probe, target: { bytes: p.minimumBytes } });
    expect(atMin.mode).toBe('encode');
    const justBelow = plan({ probe, target: { bytes: p.minimumBytes - 20_000 } });
    expect(justBelow.mode).toBe('impossible');
  });
  it('mute lowers the minimum size', () => {
    const probe = makeProbe({ durationSec: 600 });
    const a = plan({ probe, target: { bytes: 1 * MB } }).minimumBytes;
    const b = plan({ probe, target: { bytes: 1 * MB }, options: { mute: true } }).minimumBytes;
    expect(b).toBeLessThan(a);
  });
  it('copies source AAC when it is cheap enough and there is no trim', () => {
    const probe = makeProbe({ durationSec: 30, audio: { codec: 'aac', channels: 2, sampleRate: 44100, bitrate: 96_000 } });
    const p = plan({ probe, target: { bytes: 25 * MB } });
    expect(p.spec!.audio).toMatchObject({ copy: true, bitrate: 96_000, sampleRate: 44100 });
    const trimmed = plan({ probe, target: { bytes: 25 * MB }, options: { trim: { start: 2, end: 20 } } });
    expect(trimmed.spec!.audio!.copy).toBe(false);
  });
  it('uses opus in webm', () => {
    const caps: Capabilities = { ...ALL_CAPABILITIES, video: ['vp9'] };
    const p = plan({ probe: makeProbe(), target: { bytes: 10 * MB }, capabilities: caps });
    expect(p.container).toBe('webm');
    expect(p.spec!.audio!.codec).toBe('opus');
  });
  it('drops audio entirely when muted or absent', () => {
    expect(plan({ probe: makeProbe(), target: { bytes: 10 * MB }, options: { mute: true } }).spec!.audio).toBeNull();
    expect(plan({ probe: makeProbe({ audio: null }), target: { bytes: 10 * MB } }).spec!.audio).toBeNull();
  });
  it('warns on HDR', () => {
    const probe = makeProbe();
    probe.video!.hdr = true;
    expect(plan({ probe, target: { bytes: 10 * MB } }).warnings.join(' ')).toMatch(/HDR/);
  });
  it('rejects a file with no video', () => {
    expect(() => plan({ probe: { ...makeProbe(), video: null }, target: { bytes: 10 * MB } })).toThrow(/no video/);
  });
  it('is deterministic (same input → identical plan)', () => {
    const a = plan({ probe: makeProbe({ fps: 60 }), target: { bytes: 8 * MB } });
    const b = plan({ probe: makeProbe({ fps: 60 }), target: { bytes: 8 * MB } });
    expect(a).toEqual(b);
  });
});

// Golden matrix: durations × targets × source sizes (and codecs). Any change to the planner or
// TUNING shows up as a diff in golden/planner-matrix.json (update with `vitest -u`).
describe('planner golden matrix', () => {
  it('matches the committed golden file', async () => {
    const sources: [string, Partial<Probe> & { width: number; height: number; fps: number }][] = [
      ['2160p30', { width: 3840, height: 2160, fps: 30 }],
      ['1080p60', { width: 1920, height: 1080, fps: 60 }],
      ['1080p30', { width: 1920, height: 1080, fps: 30 }],
      ['portrait1080p30', { width: 1080, height: 1920, fps: 30 }],
      ['720p30', { width: 1280, height: 720, fps: 30 }],
      ['360p30', { width: 640, height: 360, fps: 30 }],
    ];
    const durations = [8, 30, 60, 300, 1800];
    const targets = [8, 10, 25, 50, 100].map((n) => n * MB);
    const rows: string[] = [];
    for (const codec of ['compatible', 'smaller'] as const) {
      for (const [name, s] of sources) {
        for (const d of durations) {
          for (const t of targets) {
            const p = plan({ probe: makeProbe({ ...s, durationSec: d, sizeBytes: 2000 * MB }), target: { bytes: t }, options: { codec } });
            const v = p.spec?.video;
            const a = p.spec?.audio;
            rows.push(
              [
                codec.padEnd(10),
                name.padEnd(15),
                `${d}s`.padStart(5),
                `${t / MB}MB`.padStart(5),
                p.mode.padEnd(10),
                v ? `${v.codec} ${v.width}x${v.height}@${v.fps}` : '-',
                v ? `v=${Math.round(v.bitrate / 1000)}k` : '',
                a ? `a=${a.bitrate / 1000}k` : '',
                v ? `bpp=${p.ladder[p.rungIndex]!.bpp.toFixed(4)}` : '',
                `min=${p.minimumBytes}`,
              ]
                .filter(Boolean)
                .join(' '),
            );
          }
        }
      }
    }
    await expect(rows.join('\n') + '\n').toMatchFileSnapshot('./golden/planner-matrix.txt');
  });
});

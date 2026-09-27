// A2: ladder rules.
import { describe, expect, it } from 'vitest';
import { MB, buildRungs, dimsForShortSide, droppedFps, normalizeOptions, plan } from '../src/index.js';
import { makeProbe, testCaps } from './fake-engine.js';

const caps = testCaps();
const rungs = (p: Parameters<typeof makeProbe>[0], o: Parameters<typeof normalizeOptions>[0] = {}, presetMax?: number) =>
  buildRungs(makeProbe(p), normalizeOptions(o), 'h264', caps, presetMax).map((r) => `${r.width}x${r.height}@${r.fps}`);

describe('ladder', () => {
  it('drops 60→30 before any resolution step (59.94→29.97, 50→25)', () => {
    expect(rungs({ fps: 60 }).slice(0, 3)).toEqual(['1920x1080@60', '1920x1080@30', '1280x720@30']);
    expect(droppedFps(59.94)).toBe(29.97);
    expect(droppedFps(50)).toBe(25);
    expect(droppedFps(48)).toBe(24);
    expect(droppedFps(90)).toBe(30);
    expect(droppedFps(30)).toBe(30);
    const p = plan(makeProbe({ fps: 60, durationSec: 30 }), { bytes: 25 * MB, label: '25 MB' }, {}, caps);
    expect(p.video).toMatchObject({ width: 1920, height: 1080, fps: 30 });
  });
  it('never upscales', () => {
    expect(rungs({ width: 640, height: 360 })[0]).toBe('640x360@30');
    const p = plan(makeProbe({ width: 640, height: 360, durationSec: 5 }), { bytes: 500 * MB, label: 'x' }, {}, caps);
    expect(p.video).toMatchObject({ width: 640, height: 360 });
    expect(dimsForShortSide(1280, 720, 1080)).toEqual({ width: 1280, height: 720 });
  });
  it('chooses rungs above 1080 when bpp ≥ good', () => {
    const p = plan(makeProbe({ width: 3840, height: 2160, durationSec: 8 }), { bytes: 50 * MB, label: 'x' }, {}, caps);
    expect(p.video).toMatchObject({ width: 3840, height: 2160 });
    const q = plan(makeProbe({ width: 3840, height: 2160, durationSec: 30 }), { bytes: 50 * MB, label: 'x' }, {}, caps);
    expect(q.video).toMatchObject({ width: 2560, height: 1440 });
  });
  it('dims are even and post-rotation', () => {
    expect(rungs({ width: 1920, height: 1080, rotation: 90 })[0]).toBe('1080x1920@30');
    expect(dimsForShortSide(1918, 1078, 1080)).toEqual({ width: 1918, height: 1078 });
    expect(dimsForShortSide(641, 361, 1080)).toEqual({ width: 642, height: 362 });
    expect(dimsForShortSide(1920, 1080, 480)).toEqual({ width: 854, height: 480 });
    for (const r of buildRungs(makeProbe({ width: 1918, height: 1082, rotation: 90 }), normalizeOptions({}), 'h264', caps)) {
      expect(r.width % 2).toBe(0);
      expect(r.height % 2).toBe(0);
    }
  });
  it('honours maxShortSide, fpsCap, keepFps and WhatsApp maxShortSide 720', () => {
    expect(rungs({}, { maxShortSide: 720 })[0]).toBe('1280x720@30');
    expect(rungs({ width: 1080, height: 1920 }, { maxShortSide: 540 })[0]).toBe('540x960@30');
    expect(rungs({ fps: 60 }, { fpsCap: 24 })[0]).toBe('1920x1080@24');
    expect(rungs({ fps: 60 }, { keepFps: true }).every((r) => r.endsWith('@60'))).toBe(true);
    const wa = plan(makeProbe({ durationSec: 20 }), { bytes: 64 * MB, presetId: 'whatsapp', label: 'WhatsApp' }, {}, caps);
    expect(wa.video).toMatchObject({ width: 1280, height: 720 });
  });
  it('fps steps 24/20/15 apply only at the lowest rung', () => {
    const r = rungs({ fps: 30 });
    expect(r.slice(-4)).toEqual(['426x240@30', '426x240@24', '426x240@20', '426x240@15']);
    expect(r.slice(0, -3).every((x) => x.endsWith('@30'))).toBe(true);
    expect(rungs({ fps: 30 }, { keepFps: true }).at(-1)).toBe('426x240@30');
    // source below 240 short side: the source is the only rung (plus fps steps)
    expect(rungs({ width: 320, height: 180, fps: 15 })).toEqual(['320x180@15']);
  });
  it('canEncode failures move down one rung', () => {
    const c = testCaps({ canEncode: (_c, w) => w <= 1280 });
    const p = plan(makeProbe({ durationSec: 8 }), { bytes: 50 * MB, label: 'x' }, {}, c);
    expect(p.video).toMatchObject({ width: 1280, height: 720 });
  });
});

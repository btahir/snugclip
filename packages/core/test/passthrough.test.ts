// A6: pass-through rule and its warnings.
import { describe, expect, it } from 'vitest';
import { MB, plan } from '../src/index.js';
import { makeProbe, testCaps } from './fake-engine.js';

const caps = testCaps();
const small = (o: Parameters<typeof makeProbe>[0] = {}) => makeProbe({ sizeBytes: 3 * MB, durationSec: 10, ...o });
const T = { bytes: 10 * MB, label: '10 MB' };

describe('pass-through', () => {
  it('passes a small file through untouched', () => {
    const p = plan(small(), T, {}, caps);
    expect(p).toMatchObject({ passThrough: true, feasible: true, video: null });
  });
  it.each([
    ['size > T', small({ sizeBytes: 11 * MB }), {}],
    ['reencode', small(), { reencode: true }],
    ['trim', small(), { trim: { startSec: 1, endSec: 5 } }],
    ['mute', small(), { mute: true }],
    ['explicit codec', small(), { codec: 'h264' }],
    ['smaller', small(), { codec: 'smaller' }],
    ['maxShortSide below source', small(), { maxShortSide: 720 }],
    ['fpsCap below source', small({ fps: 60 }), { fpsCap: 30 }],
  ] as const)('%s blocks pass-through', (_n, probe, opts) => {
    expect(plan(probe, T, opts, caps).passThrough).toBe(false);
  });
  it('options that change nothing keep pass-through', () => {
    expect(plan(small(), T, { maxShortSide: 1080, fpsCap: 30, trim: { startSec: 0, endSec: 10 } }, caps).passThrough).toBe(true);
    expect(plan(small({ audio: null }), T, { mute: true }, caps).passThrough).toBe(true);
  });
  it('warns: codec-compat, container-preview, platform-will-downscale', () => {
    const hevc = plan(small({ codec: 'hevc' }), { bytes: 20 * MB, presetId: 'discord', label: 'Discord' }, {}, caps);
    expect(hevc.warnings.map((w) => w.code)).toEqual(['codec-compat']);
    const mkv = plan(small({ container: 'matroska' }), T, {}, caps);
    expect(mkv.warnings.map((w) => w.code)).toEqual(['container-preview']);
    const wa = plan(small(), { bytes: 64 * MB, presetId: 'whatsapp', label: 'WhatsApp' }, {}, caps);
    expect(wa.warnings.map((w) => w.code)).toEqual(['platform-will-downscale']);
  });
});

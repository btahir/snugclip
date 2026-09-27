import { describe, expect, it } from 'vitest';
import type { Probe } from '@snugclip/core';
import { TYPICAL_WEB_CAPS } from '@/content/planTable';
import {
  DEFAULT_UI_OPTIONS,
  coreOptions,
  fillLevel,
  isJobFile,
  isProbablyVideo,
  maxFittingDuration,
  nextRunnable,
  previewPlan,
  reducer,
  summarize,
  type Item,
  type ToolState,
} from '@/lib/tool-model';

const probe = (durationSec: number, sizeBytes: number): Probe => ({
  container: 'mp4',
  sizeBytes,
  durationSec,
  video: { codec: 'h264', decodable: true, codedWidth: 1920, codedHeight: 1080, displayWidth: 1920, displayHeight: 1080, rotation: 0, fps: 30, bitrate: 8_000_000, hdr: false },
  audio: { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 128_000, decodable: true },
});

const item = (id: string, status: Item['status'], extra: Partial<Item> = {}): Item => ({
  id,
  file: new File([new Uint8Array(4)], `${id}.mp4`),
  name: `${id}.mp4`,
  bytes: 4,
  status,
  paused: false,
  stalled: false,
  downloaded: false,
  ...extra,
});

describe('previewPlan', () => {
  it('projects a size at or under the target for a feasible clip', () => {
    const pv = previewPlan(probe(60, 80_000_000), { bytes: 10_000_000, label: '10 MB' }, coreOptions(DEFAULT_UI_OPTIONS), TYPICAL_WEB_CAPS)!;
    expect(pv.feasible).toBe(true);
    expect(pv.passThrough).toBe(false);
    expect(pv.projectedBytes).toBeLessThanOrEqual(10_000_000);
    expect(pv.projectedBytes).toBeGreaterThan(8_000_000);
    expect(pv.minimumBytes).toBeLessThan(10_000_000);
  });
  it('refuses an impossible target and reports the minimum', () => {
    const pv = previewPlan(probe(1800, 2_000_000_000), { bytes: 1_000_000, label: '1 MB' }, coreOptions(DEFAULT_UI_OPTIONS), TYPICAL_WEB_CAPS)!;
    expect(pv.feasible).toBe(false);
    expect(pv.minimumBytes).toBeGreaterThan(1_000_000);
  });
  it('passes through a file already under the target', () => {
    const pv = previewPlan(probe(5, 400_000), { bytes: 10_000_000, label: '10 MB' }, coreOptions(DEFAULT_UI_OPTIONS), TYPICAL_WEB_CAPS)!;
    expect(pv.passThrough).toBe(true);
    expect(pv.projectedBytes).toBe(400_000);
  });
  it('re-encode override disables pass-through', () => {
    const pv = previewPlan(probe(5, 400_000), { bytes: 10_000_000, label: '10 MB' }, coreOptions(DEFAULT_UI_OPTIONS, undefined, { reencode: true }), TYPICAL_WEB_CAPS)!;
    expect(pv.passThrough).toBe(false);
  });
});

describe('coreOptions', () => {
  it('merges trim and per-item overrides', () => {
    const o = coreOptions({ ...DEFAULT_UI_OPTIONS, maxShortSide: 720 }, { startSec: 1, endSec: 3 }, { mute: true });
    expect(o).toEqual({ codec: 'compatible', mute: true, keepFps: false, reencode: false, maxShortSide: 720, trim: { startSec: 1, endSec: 3 } });
  });
});

describe('queue', () => {
  it('runs one encode at a time, in order', () => {
    expect(nextRunnable([item('a', 'ready'), item('b', 'queued'), item('c', 'queued')])?.id).toBe('b');
    expect(nextRunnable([item('a', 'running'), item('b', 'queued')])).toBeNull();
    expect(nextRunnable([item('a', 'impossible')])).toBeNull();
  });
  it('summarises states for the queue bar', () => {
    expect(summarize([item('a', 'ready'), item('b', 'running'), item('c', 'queued'), item('d', 'probing'), item('e', 'error'), item('f', 'impossible')])).toEqual({
      total: 6,
      ready: 1,
      running: 1,
      waiting: 2,
      attention: 2,
    });
  });
  it('reducer removes items and clears their expansion', () => {
    const s: ToolState = { target: { bytes: 1e7, label: '10 MB' }, options: DEFAULT_UI_OPTIONS, items: [item('a', 'ready'), item('b', 'queued')], expandedId: 'a', trimId: 'a' };
    const n = reducer(s, { type: 'remove', id: 'a' });
    expect(n.items.map((i) => i.id)).toEqual(['b']);
    expect(n.expandedId).toBeNull();
    expect(n.trimId).toBeNull();
  });
  it('clearDone keeps work in progress', () => {
    const s: ToolState = { target: { bytes: 1e7, label: '10 MB' }, options: DEFAULT_UI_OPTIONS, items: [item('a', 'ready'), item('b', 'running'), item('c', 'cancelled')], expandedId: 'a', trimId: null };
    expect(reducer(s, { type: 'clearDone' }).items.map((i) => i.id)).toEqual(['b']);
  });
});

describe('meter maths', () => {
  it('never fills past the line', () => {
    expect(fillLevel(9_999_999, 10_000_000)).toBeLessThan(1);
    expect(fillLevel(12_000_000, 10_000_000)).toBe(1);
    expect(fillLevel(0, 10_000_000)).toBe(0);
    expect(fillLevel(5, 0)).toBe(0);
  });
  it('suggests a trim length that scales with the minimum', () => {
    expect(maxFittingDuration(300, 3_530_000, 2_000_000)).toBeLessThan(300 * (2 / 3.53));
    expect(maxFittingDuration(300, 3_530_000, 2_000_000)).toBeGreaterThan(150);
  });
});

describe('file detection', () => {
  it('recognises videos and job files', () => {
    expect(isProbablyVideo(new File([], 'a.MOV'))).toBe(true);
    expect(isProbablyVideo(new File([], 'x', { type: 'video/webm' }))).toBe(true);
    expect(isProbablyVideo(new File([], 'notes.txt'))).toBe(false);
    expect(isProbablyVideo(new File([], 'song.m4a'))).toBe(true);
    expect(isJobFile(new File([], 'setup.snugclip.json'))).toBe(true);
    expect(isJobFile(new File([], 'data.json'))).toBe(false);
  });
});

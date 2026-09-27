import type { EncodePlan } from '@snugclip/core';
import { isSnugclipError } from '@snugclip/core';
import { Quality } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import {
  assessDiscarded,
  buildAudioOptions,
  buildVideoEncodingConfig,
  buildVideoOptions,
  chooseTargetKind,
  conversionTrim,
  effectiveLatency,
  estimateOutputBytes,
  nextUntil,
  outputFormatSpec,
  resolveRange,
} from '../src/conversion-options.js';

const encodePlan = (over: Partial<EncodePlan<unknown>> = {}): EncodePlan<unknown> => ({
  input: null,
  purpose: 'full',
  container: 'mp4',
  video: { codec: 'h264', width: 1280, height: 720, fps: 30, bitrate: 2_000_000, keyframeIntervalSec: 2, latency: 'quality' },
  audio: { mode: 'encode', codec: 'aac', bitrate: 96_000, channels: 2, sampleRate: 48000, bytes: 0 },
  hdrToSdr: false,
  ...over,
});

/** Reads Quality's private fields (the class has no public getters). */
const q = (x: unknown) => x as { _bitrate?: number; _bitrateMode?: string };

describe('ranges and trim', () => {
  it('starts at 0 without a trim so output t maps to source t', () => {
    expect(resolveRange(undefined, 12.5)).toEqual({ start: 0, end: 12.5, len: 12.5 });
    expect(conversionTrim(resolveRange(undefined, 12.5), undefined)).toEqual({ start: 0 });
  });

  it('clamps a trim to the source and passes both ends', () => {
    const r = resolveRange({ startSec: 2, endSec: 99 }, 10);
    expect(r).toEqual({ start: 2, end: 10, len: 8 });
    expect(conversionTrim(r, { startSec: 2, endSec: 99 })).toEqual({ start: 2, end: 10 });
  });

  it('survives an unknown duration', () => {
    expect(resolveRange(undefined, NaN).len).toBe(0);
    expect(resolveRange({ startSec: 1, endSec: 3 }, 0)).toEqual({ start: 1, end: 3, len: 2 });
  });
});

describe('video options', () => {
  it('maps the plan to Conversion video options', () => {
    const o = buildVideoOptions(encodePlan());
    expect(o).toMatchObject({
      codec: 'avc',
      width: 1280,
      height: 720,
      fit: 'fill',
      frameRate: 30,
      keyFrameInterval: 2,
      forceTranscode: true,
      allowTransformationMetadata: false,
    });
    expect(o.quality).toBeInstanceOf(Quality);
    expect(q(o.quality)._bitrate).toBe(2_000_000);
    expect(q(o.quality)._bitrateMode).toBe('variable');
    expect(o.process).toBeUndefined();
  });

  it('adds the HDR process hook with its output size', () => {
    const process = () => null;
    const o = buildVideoOptions(encodePlan({ video: { ...encodePlan().video, codec: 'av1', width: 640, height: 360 } }), process);
    expect(o.codec).toBe('av1');
    expect(o.process).toBe(process);
    expect(o).toMatchObject({ processedWidth: 640, processedHeight: 360 });
  });

  it('builds the manual-pipeline encoder config with latencyMode and transform', () => {
    const cfg = buildVideoEncodingConfig(encodePlan({ video: { ...encodePlan().video, codec: 'vp9', fps: 24 } }), 'realtime');
    expect(cfg).toMatchObject({
      codec: 'vp9',
      latencyMode: 'realtime',
      keyFrameInterval: 2,
      sizeChangeBehavior: 'passThrough',
      transform: { width: 1280, height: 720, fit: 'fill', frameRate: 24, force: true },
    });
    expect(q(cfg.quality)._bitrate).toBe(2_000_000);
  });

  it('uses realtime when the core asks or the probe found stalls', () => {
    expect(effectiveLatency('quality', 'quality')).toBe('quality');
    expect(effectiveLatency(undefined, 'quality')).toBe('quality');
    expect(effectiveLatency('realtime', 'quality')).toBe('realtime');
    expect(effectiveLatency('quality', 'realtime')).toBe('realtime');
  });
});

describe('audio options', () => {
  it('discards, copies or encodes', () => {
    expect(buildAudioOptions({ mode: 'none', bytes: 0 })).toEqual({ discard: true });
    expect(buildAudioOptions({ mode: 'copy', codec: 'aac', bitrate: 128_000, bytes: 1 })).toEqual({ forceTranscode: false });
    const enc = buildAudioOptions({ mode: 'encode', codec: 'opus', bitrate: 48_000, channels: 1, sampleRate: 48000, bytes: 1 });
    expect(enc).toMatchObject({ codec: 'opus', numberOfChannels: 1, sampleRate: 48000, forceTranscode: true });
    expect(q(enc.quality)._bitrate).toBe(48_000);
  });

  it('refuses an encode plan without a codec', () => {
    expect(() => buildAudioOptions({ mode: 'encode', bytes: 0 })).toThrow(/missing/);
  });
});

describe('output target', () => {
  it('estimates bytes from requested bitrates', () => {
    expect(estimateOutputBytes(encodePlan(), 10)).toBe(Math.ceil((2_096_000 * 10) / 8));
    expect(estimateOutputBytes(encodePlan({ audio: { mode: 'none', bytes: 0 } }), 8)).toBe(2_000_000);
  });

  it('keeps small outputs in memory and streams big ones to OPFS when available', () => {
    expect(chooseTargetKind(100e6, { opfsAvailable: true })).toBe('buffer');
    expect(chooseTargetKind(450e6, { opfsAvailable: true })).toBe('opfs');
    expect(chooseTargetKind(2e9, { opfsAvailable: false })).toBe('buffer');
  });

  it('uses fast-start MP4 in memory, index-at-end when streamed, and WebM for VP9', () => {
    expect(outputFormatSpec('mp4', 'buffer')).toEqual({ container: 'mp4', fastStart: 'in-memory' });
    expect(outputFormatSpec('mp4', 'opfs')).toEqual({ container: 'mp4', fastStart: false });
    expect(outputFormatSpec('webm', 'buffer')).toEqual({ container: 'webm' });
  });
});

describe('discarded tracks', () => {
  it('passes when nothing we need was dropped', () => {
    expect(assessDiscarded([], { video: true, audio: true })).toBeNull();
    expect(assessDiscarded([{ type: 'audio', reason: 'discarded_by_user' }], { video: true, audio: false })).toBeNull();
    expect(assessDiscarded([{ type: 'audio', reason: 'undecodable_source_codec' }], { video: true, audio: false })).toBeNull();
  });

  it('maps a dropped video track to unsupported input or encoder', () => {
    const dec = assessDiscarded([{ type: 'video', reason: 'undecodable_source_codec' }], { video: true, audio: false });
    expect(isSnugclipError(dec) && dec.code).toBe('E_UNSUPPORTED');
    const enc = assessDiscarded([{ type: 'video', reason: 'no_encodable_target_codec' }], { video: true, audio: false });
    expect(enc?.code).toBe('E_UNSUPPORTED_ENCODER');
  });

  it('never drops audio silently', () => {
    expect(assessDiscarded([{ type: 'audio', reason: 'no_encodable_target_codec' }], { video: true, audio: true })?.code).toBe('E_UNSUPPORTED_ENCODER');
    const e = assessDiscarded([{ type: 'audio', reason: 'undecodable_source_codec' }], { video: true, audio: true });
    expect(e?.code).toBe('E_UNSUPPORTED');
    expect(e?.hint).toMatch(/Mute/);
  });
});

describe('stepped execution (pause)', () => {
  it('advances two output seconds per completed step and finishes with Infinity', () => {
    let until = 0;
    const seen: number[] = [];
    for (let i = 0; i < 10 && until !== Infinity; i++) {
      until = nextUntil(until, Math.max(0, until), 7, false);
      seen.push(until);
    }
    expect(seen).toEqual([2, 4, 6, 8, Infinity]);
  });

  it('resumes towards the same until after a mid-step pause', () => {
    expect(nextUntil(4, 3, 20, true)).toBe(5);
    expect(nextUntil(6, 3, 20, true)).toBe(6);
  });

  it('never loops when progress is stuck or the length is unknown', () => {
    expect(nextUntil(2, 0, 20, false)).toBe(4);
    expect(nextUntil(0, 0, 0, false)).toBe(Infinity);
  });
});

import { SnugclipError } from '@snugclip/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapEngineError } from '../src/errors-map.js';
import { evalDims, sortedTimes } from '../src/frames.js';
import { latencyFromProbe, probeEncoderLatency, probeFrameI420, raceTimeout } from '../src/latency-probe.js';
import { hasRoom, isSnugclipOpfsName, opfsFileName } from '../src/opfs.js';
import { createPauseController, holdWhilePaused, raceAbort } from '../src/pause.js';
import { summarizeSupport } from '../src/support.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('pause', () => {
  it('passes straight through an open gate without starting a heartbeat', async () => {
    const pc = createPauseController();
    const timers = { setInterval: vi.fn(), clearInterval: vi.fn() };
    await holdWhilePaused(pc.gate, { heartbeat: () => {}, timers });
    expect(timers.setInterval).not.toHaveBeenCalled();
    await holdWhilePaused(undefined);
  });

  it('holds while paused, heartbeats for the stall watchdog, and releases on resume', async () => {
    vi.useFakeTimers();
    const pc = createPauseController();
    const onPause = vi.fn();
    pc.gate.onPause?.(onPause);
    pc.pause();
    expect(pc.paused).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
    const beats = vi.fn();
    let released = false;
    const p = holdWhilePaused(pc.gate, { heartbeat: beats, heartbeatMs: 5000 }).then(() => (released = true));
    await vi.advanceTimersByTimeAsync(16_000);
    expect(beats).toHaveBeenCalledTimes(3);
    expect(released).toBe(false);
    pc.resume();
    await p;
    expect(released).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(beats).toHaveBeenCalledTimes(3); // interval cleared
  });

  it('cancelling while paused rejects with E_CANCELLED', async () => {
    const pc = createPauseController();
    pc.pause();
    const ctl = new AbortController();
    const p = holdWhilePaused(pc.gate, { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: 'E_CANCELLED' });
    await expect(raceAbort(Promise.resolve(1), ctl.signal)).rejects.toMatchObject({ code: 'E_CANCELLED' });
    await expect(raceAbort(Promise.resolve(7), new AbortController().signal)).resolves.toBe(7);
  });

  it('unsubscribes pause listeners', () => {
    const pc = createPauseController();
    const l = vi.fn();
    const off = pc.gate.onPause!(l);
    off();
    pc.pause();
    expect(l).not.toHaveBeenCalled();
  });
});

describe('latency probe', () => {
  it('reports a timeout only when the flush hangs', async () => {
    vi.useFakeTimers();
    const hang = raceTimeout(new Promise<void>(() => {}), 2000);
    await vi.advanceTimersByTimeAsync(2001);
    const r = await hang;
    expect(r).toEqual({ ok: false, reason: 'timeout' });
    expect(latencyFromProbe(r)).toBe('realtime');
  });

  it('treats a quick flush or an encoder error as "quality"', async () => {
    const ok = await raceTimeout(Promise.resolve(5), 2000);
    expect(ok).toEqual({ ok: true, value: 5 });
    expect(latencyFromProbe(ok)).toBe('quality');
    const err = await raceTimeout(Promise.reject(new Error('nope')), 2000);
    expect(err.ok).toBe(false);
    expect(latencyFromProbe(err)).toBe('quality');
  });

  it('makes varying I420 frames of the right size', () => {
    const a = probeFrameI420(0);
    const b = probeFrameI420(1);
    expect(a.length).toBe(128 * 128 * 1.5);
    expect(a[128 * 128]).toBe(128);
    expect(a.subarray(0, 64)).not.toEqual(b.subarray(0, 64));
  });

  it('is a no-op without WebCodecs (Node)', async () => {
    expect(await probeEncoderLatency()).toBe('quality');
  });
});

describe('frames helpers', () => {
  it('scales display dims so the short side is the eval side, both orientations', () => {
    expect(evalDims(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(evalDims(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(evalDims(640, 360, 360)).toEqual({ width: 640, height: 360 });
    // Output at 480p is upscaled to the same eval size, so resolution loss shows in SSIM.
    expect(evalDims(854, 480, 720)).toEqual({ width: 1281, height: 720 });
    expect(evalDims(0, 0, 720)).toEqual({ width: 720, height: 720 });
  });

  it('sorts times for the sink and remembers the caller order', () => {
    expect(sortedTimes([5, 1, 3, -2, NaN])).toEqual([
      { t: 0, index: 3 },
      { t: 0, index: 4 },
      { t: 1, index: 1 },
      { t: 3, index: 2 },
      { t: 5, index: 0 },
    ]);
  });
});

describe('support summary', () => {
  it('refuses browsers without WebCodecs or without H.264/VP9', () => {
    const none = summarizeSupport({ hasVideoEncoder: false, hasVideoDecoder: true, videoCodecs: [], audioCodecs: [] });
    expect(none).toMatchObject({ ok: false, code: 'no-webcodecs' });
    expect(none.reason).toMatch(/Chrome, Edge, Firefox/);
    expect(summarizeSupport({ hasVideoEncoder: true, hasVideoDecoder: true, videoCodecs: ['av1'], audioCodecs: ['opus'] })).toMatchObject({ ok: false, code: 'no-video-encoder' });
  });

  it('accepts Firefox without AAC (the engine loads its own encoder)', () => {
    const ff = summarizeSupport({ hasVideoEncoder: true, hasVideoDecoder: true, videoCodecs: ['h264', 'vp9'], audioCodecs: ['opus'] });
    expect(ff).toEqual({ ok: true, videoCodecs: ['h264', 'vp9'], audioCodecs: ['opus'] });
  });
});

describe('OPFS helpers', () => {
  it('names and recognises our files only', () => {
    const n = opfsFileName('1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'mp4');
    expect(n).toBe('snugclip-1b4e28ba-2fa1-11d2-883f-0016d3cca427.mp4');
    expect(isSnugclipOpfsName(n)).toBe(true);
    expect(opfsFileName('../evil/x', 'webm')).toBe('snugclip-evilx.webm');
    expect(isSnugclipOpfsName('someone-else.mp4')).toBe(false);
    expect(isSnugclipOpfsName('snugclip-notes.txt')).toBe(false);
  });

  it('checks quota headroom', () => {
    expect(hasRoom({ quota: 1000, usage: 400 }, 600)).toBe(true);
    expect(hasRoom({ quota: 1000, usage: 401 }, 600)).toBe(false);
    expect(hasRoom(null, 1e12)).toBe(true);
    expect(hasRoom({}, 1e12)).toBe(true);
  });
});

describe('error mapping', () => {
  const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });

  it('keeps Snugclip errors and maps cancellation from any source', () => {
    const own = new SnugclipError('E_TRIM', 'bad');
    expect(mapEngineError(own)).toBe(own);
    expect(mapEngineError(named('ConversionCanceledError')).code).toBe('E_CANCELLED');
    expect(mapEngineError(named('AbortError')).code).toBe('E_CANCELLED');
    const ctl = new AbortController();
    ctl.abort();
    expect(mapEngineError(named('InputDisposedError'), ctl.signal).code).toBe('E_CANCELLED');
  });

  it('maps quota, unreadable input, unsupported config and everything else', () => {
    expect(mapEngineError(named('QuotaExceededError')).code).toBe('E_QUOTA');
    expect(mapEngineError(named('UnsupportedInputFormatError')).code).toBe('E_UNSUPPORTED');
    expect(mapEngineError(named('NotSupportedError', 'hevc')).code).toBe('E_UNSUPPORTED_ENCODER');
    const e = mapEngineError(new Error('boom'));
    expect(e.code).toBe('E_ENCODE');
    expect(e.message).toContain('boom');
    expect(mapEngineError(new Error('bad box'), undefined, 'probe').code).toBe('E_UNSUPPORTED');
    expect(mapEngineError('weird', undefined, 'frames').message).toMatch(/quality check/);
  });
});

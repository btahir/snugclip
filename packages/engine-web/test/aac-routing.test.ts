import { describe, expect, it } from 'vitest';
import { CustomAudioEncoder } from 'mediabunny';
import { isNativeAacSafe, plan, TUNING, type Probe } from '@snugclip/core';
import { aacNeedsWasm, makeCanEncodeAudio, type AacRouting } from '../src/aac-routing.js';
import { routedEncoder, setAacRoute } from '../src/aac-loader.js';
import { buildCapabilities, emptyEncodeTable } from '../src/capabilities.js';

const r = (o: Partial<AacRouting> = {}): AacRouting => ({ native: true, wasmAvailable: true, nativeFailed: false, ...o });

describe('AAC routing (native allowlist vs WASM)', () => {
  it('native only on the allowlist; everything below goes to WASM', () => {
    expect(TUNING.nativeAacSafe.minBitrate).toBe(96_000);
    expect(aacNeedsWasm(r(), 128_000, 2, 48000)).toBe(false);
    expect(aacNeedsWasm(r(), 96_000, 1, 44100)).toBe(false);
    for (const [b, ch, sr] of [[32_000, 1, 44100], [32_000, 2, 48000], [48_000, 2, 44100], [64_000, 2, 44100], [24_000, 1, 48000]] as const) {
      expect(aacNeedsWasm(r(), b, ch, sr), `${b}/${ch}/${sr}`).toBe(true);
    }
  });
  it('no native AAC, or a native failure this session → always WASM', () => {
    expect(aacNeedsWasm(r({ native: false }), 128_000, 2, 48000)).toBe(true);
    expect(aacNeedsWasm(r({ nativeFailed: true }), 128_000, 2, 48000)).toBe(true);
  });
  it('canEncodeAudio: low AAC bitrates need WASM available; Opus is unconstrained', () => {
    expect(makeCanEncodeAudio(r())('aac', 32_000, 1, 48000)).toBe(true);
    expect(makeCanEncodeAudio(r({ wasmAvailable: false }))('aac', 32_000, 1, 48000)).toBe(false);
    expect(makeCanEncodeAudio(r({ wasmAvailable: false }))('aac', 96_000, 1, 48000)).toBe(true);
    expect(makeCanEncodeAudio(r({ native: false, wasmAvailable: false }))('opus', 16_000, 1, 48000)).toBe(true);
  });
  it('routedEncoder: the WASM class only claims configs the route allows', () => {
    class FakeWasm extends CustomAudioEncoder {
      static override supports(codec: string, _config?: unknown) {
        return codec === 'aac';
      }
      init() {}
      encode() {}
      flush() {}
      close() {}
    }
    const Routed = routedEncoder(FakeWasm) as typeof FakeWasm;
    expect(Routed.prototype instanceof CustomAudioEncoder).toBe(true);
    const state = r();
    setAacRoute((cfg) => aacNeedsWasm(state, cfg.bitrate ?? 0, cfg.numberOfChannels, cfg.sampleRate));
    expect(Routed.supports('aac', { bitrate: 48_000, numberOfChannels: 2, sampleRate: 48000 } as never)).toBe(true);
    expect(Routed.supports('aac', { bitrate: 128_000, numberOfChannels: 2, sampleRate: 48000 } as never)).toBe(false);
    state.nativeFailed = true;
    expect(Routed.supports('aac', { bitrate: 128_000, numberOfChannels: 2, sampleRate: 48000 } as never)).toBe(true);
    setAacRoute(() => true);
    expect(routedEncoder('not a class')).toBe('not a class');
  });
});

describe('planner with web capabilities', () => {
  const video = emptyEncodeTable();
  video.h264 = { 720: true, 1080: true, 2160: true };
  video.vp9 = { 720: true, 1080: true, 2160: true };
  // F06-like: 10 s rotated 1080p with 128 kbps stereo AAC; F11-like: 5 min 360p with 48 kbps mono AAC.
  const f06: Probe = {
    container: 'mp4', sizeBytes: 5_261_728, durationSec: 10,
    video: { codec: 'h264', decodable: true, codedWidth: 1920, codedHeight: 1080, displayWidth: 1080, displayHeight: 1920, rotation: 270, fps: 30, hdr: false },
    audio: { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 128_000, decodable: true },
  };
  const f11: Probe = {
    container: 'mp4', sizeBytes: 13_394_813, durationSec: 300,
    video: { codec: 'h264', decodable: true, codedWidth: 640, codedHeight: 360, displayWidth: 640, displayHeight: 360, rotation: 0, fps: 30, hdr: false },
    audio: { codec: 'aac', channels: 1, sampleRate: 48000, bitrate: 48_000, decodable: true },
  };
  it('with WASM available, low budgets get low-bitrate AAC (routed to WASM)', () => {
    const caps = buildCapabilities({ video, audio: { aac: true, opus: true }, aac: r() });
    const p = plan(f06, { bytes: 1_000_000, label: '1 MB' }, {}, caps);
    expect(p.feasible).toBe(true);
    expect(p.audio.mode).toBe('encode');
    expect(p.audio.bitrate!).toBeLessThan(96_000);
    expect(aacNeedsWasm(r(), p.audio.bitrate!, p.audio.channels!, p.audio.sampleRate!)).toBe(true);
  });
  it('without WASM, native AAC stays on the allowlist (or the source is copied) and plans still fit the target', () => {
    const caps = buildCapabilities({ video, audio: { aac: true, opus: true }, aac: r({ wasmAvailable: false }) });
    for (const [probe, T] of [[f06, 1_000_000], [f11, 8_000_000]] as const) {
      const p = plan(probe, { bytes: T, label: 'x' }, {}, caps);
      if (p.audio.mode === 'encode') expect(isNativeAacSafe(p.audio.bitrate!, p.audio.channels!, p.audio.sampleRate!)).toBe(true);
      if (p.feasible) expect(p.overheadBytes + p.audio.bytes + (p.video!.bitrate * p.durationSec) / 8).toBeLessThanOrEqual(T);
    }
  });
});

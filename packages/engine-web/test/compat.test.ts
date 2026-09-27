// Compat fixes A2/A4/A5 (pure parts). Chrome behaviour is unchanged by these.
import { describe, expect, it } from 'vitest';
import { assessDiscarded, chooseTargetKind, BUFFER_TARGET_MAX_BYTES } from '../src/conversion-options.js';
import { headerLooksValid, MEMORY_FALLBACK_MAX_BYTES } from '../src/encode.js';
import { withTimeout, CAPABILITY_PROBE_TIMEOUT_MS } from '../src/engine.js';

describe('A5: capability probes time out', () => {
  it('a hanging probe resolves to the fallback; a quick one to its value', async () => {
    expect(CAPABILITY_PROBE_TIMEOUT_MS).toBe(5000);
    expect(await withTimeout(new Promise<boolean>(() => {}), 20, false)).toBe(false);
    expect(await withTimeout(Promise.resolve(true), 20, false)).toBe(true);
  });
});

describe('A4: in-memory output ceiling', () => {
  it('defaults to 512 MB and honours maxBufferBytes', () => {
    expect(BUFFER_TARGET_MAX_BYTES).toBe(512_000_000);
    expect(chooseTargetKind(300e6, { opfsAvailable: true })).toBe('buffer');
    expect(chooseTargetKind(300e6, { opfsAvailable: true, maxBufferBytes: 192e6 })).toBe('opfs');
    expect(chooseTargetKind(300e6, { opfsAvailable: false, maxBufferBytes: 192e6 })).toBe('buffer');
  });
});

describe('A2: OPFS fallback and header check', () => {
  it('memory fallback allows up to 1.5 GB', () => {
    expect(MEMORY_FALLBACK_MAX_BYTES).toBe(1_500_000_000);
  });
  it('recognises valid MP4/WebM starts and a zeroed first chunk', () => {
    expect(headerLooksValid(Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]), 'mp4')).toBe(true);
    expect(headerLooksValid(new Uint8Array(8), 'mp4')).toBe(false);
    expect(headerLooksValid(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), 'webm')).toBe(true);
    expect(headerLooksValid(new Uint8Array(8), 'webm')).toBe(false);
  });
});

describe('A3: discard errors name the track', () => {
  it('audio and video failures carry details.track', () => {
    expect(assessDiscarded([{ type: 'audio', reason: 'undecodable_source_codec' }], { video: true, audio: true })?.details).toMatchObject({ track: 'audio' });
    expect(assessDiscarded([{ type: 'video', reason: 'undecodable_source_codec' }], { video: true, audio: true })?.details).toMatchObject({ track: 'video' });
    expect(assessDiscarded([{ type: 'audio', reason: 'no_encodable_target_codec' }], { video: true, audio: true })?.details).toMatchObject({ track: 'audio' });
  });
});

import { describe, expect, it } from 'vitest';
import { plan, type Probe } from '@snugclip/core';
import { audioConfigKey, makeCanEncodeAudio } from '../src/audio-probe.js';
import { buildCapabilities, emptyEncodeTable } from '../src/capabilities.js';

describe('audio config probe → canEncodeAudio', () => {
  it('null set means unconstrained; a set restricts to probed configs', () => {
    expect(makeCanEncodeAudio(null)!('aac', 24_000, 1, 48000)).toBe(true);
    const ok = new Set([audioConfigKey('aac', 48_000, 1, 48000), audioConfigKey('aac', 128_000, 2, 48000)]);
    const f = makeCanEncodeAudio(ok)!;
    expect(f('aac', 48_000, 1, 48000)).toBe(true);
    expect(f('aac', 48_000, 2, 48000)).toBe(false);
    expect(f('aac', 24_000, 1, 48000)).toBe(false);
  });
  it('the planner avoids AAC configs the browser rejects (Chrome on macOS)', () => {
    const video = emptyEncodeTable();
    video.h264 = { 720: true, 1080: true, 2160: true };
    const ok = new Set<string>();
    for (const sr of [44100, 48000]) {
      for (const k of [48, 64, 96, 128]) ok.add(audioConfigKey('aac', k * 1000, 1, sr));
      for (const k of [96, 128]) ok.add(audioConfigKey('aac', k * 1000, 2, sr));
    }
    const caps = buildCapabilities({ video, audio: { aac: true, opus: false }, audioConfigs: ok });
    const probe: Probe = {
      container: 'mp4', sizeBytes: 5_000_000, durationSec: 10,
      video: { codec: 'h264', decodable: true, codedWidth: 1920, codedHeight: 1080, displayWidth: 1080, displayHeight: 1920, rotation: 270, fps: 30, hdr: false },
      audio: { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 128_000, decodable: true },
    };
    const p = plan(probe, { bytes: 1_000_000, label: '1 MB' }, {}, caps);
    expect(p.feasible).toBe(true);
    expect(caps.canEncodeAudio!('aac', p.audio.bitrate!, p.audio.channels!, p.audio.sampleRate!)).toBe(true);
    expect(p.audio).toMatchObject({ bitrate: 64_000, channels: 1 });
  });
});

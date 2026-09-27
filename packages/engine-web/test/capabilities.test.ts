import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan } from '@snugclip/core';
import type { Probe } from '@snugclip/core';
import { describe, expect, it } from 'vitest';
import { buildCapabilities, emptyEncodeTable, makeCanEncode, maxShortSides, MEDIABUNNY_VERSION, probeBitrate, tierFor } from '../src/capabilities.js';
import type { CapabilityInputs, EncodeTable } from '../src/capabilities.js';

const here = dirname(fileURLToPath(import.meta.url));

function table(rows: Partial<Record<keyof EncodeTable, [boolean, boolean, boolean]>>): EncodeTable {
  const t = emptyEncodeTable();
  for (const [codec, [a, b, c]] of Object.entries(rows) as Array<[keyof EncodeTable, [boolean, boolean, boolean]]>) t[codec] = { 720: a, 1080: b, 2160: c };
  return t;
}

const chrome: CapabilityInputs = {
  video: table({ h264: [true, true, true], vp9: [true, true, true], av1: [true, true, false], hevc: [false, false, false] }),
  audio: { aac: true, opus: true },
};
const firefoxNoAac: CapabilityInputs = { video: table({ h264: [true, true, true], vp9: [true, true, true] }), audio: { aac: false, opus: true } };

const probe: Probe = {
  container: 'mp4',
  sizeBytes: 80_000_000,
  durationSec: 60,
  video: { codec: 'h264', decodable: true, codedWidth: 1920, codedHeight: 1080, displayWidth: 1920, displayHeight: 1080, rotation: 0, fps: 30, bitrate: 10_000_000, hdr: false },
  audio: { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 256_000, decodable: true },
};

describe('capabilities', () => {
  it('pins mediabunny to the installed version', () => {
    const pkg = JSON.parse(readFileSync(join(here, '../node_modules/mediabunny/package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toBe(MEDIABUNNY_VERSION);
  });

  it('picks the smallest probe tier covering a size in either orientation', () => {
    expect(tierFor(1280, 720)).toBe(720);
    expect(tierFor(720, 1280)).toBe(720);
    expect(tierFor(854, 480)).toBe(720);
    expect(tierFor(1920, 800)).toBe(1080);
    expect(tierFor(2560, 720)).toBe(2160); // too long for the 1080 box
    expect(tierFor(3840, 2160)).toBe(2160);
    expect(tierFor(7680, 4320)).toBeNull();
  });

  it('answers canEncode synchronously from the table', () => {
    const can = makeCanEncode(chrome.video);
    expect(can('h264', 3840, 2160, 20e6)).toBe(true);
    expect(can('av1', 1920, 1080, 3e6)).toBe(true);
    expect(can('av1', 2560, 1440, 3e6)).toBe(false);
    expect(can('hevc', 1280, 720, 1e6)).toBe(false);
    expect(can('h264', 0, 720, 1e6)).toBe(false);
    expect(can('h264', 1280, 720, 0)).toBe(false);
    expect(can('h264', 7680, 4320, 50e6)).toBe(false);
  });

  it('reports the largest encodable short side per codec', () => {
    expect(maxShortSides(chrome.video)).toEqual({ h264: 2160, vp9: 2160, av1: 1080 });
  });

  it('builds EngineCapabilities with the web engine constants', () => {
    const caps = buildCapabilities(chrome);
    expect(caps).toMatchObject({
      id: 'web',
      videoCodecs: ['h264', 'av1', 'vp9'],
      audioCodecs: ['aac', 'opus'],
      containers: ['mp4', 'webm'],
      twoPass: false,
      initialMargin: 0.04,
      rateCalibration: 'always',
      audioCopyWithTrim: false,
      encoderName: { h264: 'WebCodecs H.264', av1: 'WebCodecs AV1', vp9: 'WebCodecs VP9' },
    });
    expect(caps.version).toContain(MEDIABUNNY_VERSION);
    expect(probeBitrate(1920, 1080)).toBe(6_220_800);
  });

  it('drives the core planner: Chrome gets H.264/AAC MP4, "smaller" gets AV1', () => {
    const p = plan(probe, { bytes: 20_000_000, label: '20 MB' }, { codec: 'compatible' }, buildCapabilities(chrome));
    expect(p.feasible).toBe(true);
    expect(p.container).toBe('mp4');
    expect(p.video?.codec).toBe('h264');
    expect(p.audio.codec).toBe('aac');
    const s = plan(probe, { bytes: 20_000_000, label: '20 MB' }, { codec: 'smaller' }, buildCapabilities(chrome));
    expect(s.video?.codec).toBe('av1');
  });

  it('drives the core planner: no AAC encoder means WebM (VP9 + Opus)', () => {
    const p = plan(probe, { bytes: 20_000_000, label: '20 MB' }, { codec: 'compatible' }, buildCapabilities(firefoxNoAac));
    expect(p.container).toBe('webm');
    expect(p.video?.codec).toBe('vp9');
    expect(p.audio.codec).toBe('opus');
    expect(p.warnings.map((w) => w.code)).toContain('aac-unavailable');
  });

  it('keeps the planner inside the encodable size (AV1 capped at 1080 on a 4K source)', () => {
    const uhd: Probe = { ...probe, sizeBytes: 900_000_000, video: { ...probe.video!, codedWidth: 3840, codedHeight: 2160, displayWidth: 3840, displayHeight: 2160, bitrate: 60_000_000 } };
    const p = plan(uhd, { bytes: 500_000_000, label: '500 MB' }, { codec: 'av1' }, buildCapabilities(chrome));
    expect(p.video!.height).toBeLessThanOrEqual(1080);
  });
});

import { describe, expect, it } from 'vitest';
import { bitDepthFromCodecString, encoderLabel, fromMediabunnyVideoCodec, mimeFor, normalizeAudioCodec, normalizeVideoCodec, toMediabunnyVideoCodec } from '../src/codec-strings.js';
import { buildProbe, containerFromFormatName, isHdr, normalizeRotation, pickFps, transferName } from '../src/probe-map.js';
import type { RawProbe, RawVideoTrack } from '../src/probe-map.js';

const video = (over: Partial<RawVideoTrack> = {}): RawVideoTrack => ({
  codec: 'avc',
  codecString: 'avc1.64001f',
  codedWidth: 1920,
  codedHeight: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  rotation: 0,
  fps: 29.97002997,
  packetRate: 29.9,
  frameCount: 300,
  measuredBitrate: 8_000_123.4,
  metadataBitrate: 7_000_000,
  hdr: false,
  colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' },
  decodable: true,
  ...over,
});

const raw = (over: Partial<RawProbe> = {}): RawProbe => ({
  formatName: 'MP4',
  sizeBytes: 12_345_678,
  durationSec: 10.01,
  video: video(),
  audio: { codec: 'aac', channels: 2, sampleRate: 48000, measuredBitrate: 128_400, metadataBitrate: null, decodable: true },
  ...over,
});

describe('codec names', () => {
  it('maps core ids to mediabunny ids and back', () => {
    expect(toMediabunnyVideoCodec('h264')).toBe('avc');
    expect(toMediabunnyVideoCodec('vp9')).toBe('vp9');
    expect(fromMediabunnyVideoCodec('avc')).toBe('h264');
    expect(fromMediabunnyVideoCodec('vp8')).toBeNull();
  });

  it('normalises source video codecs to ffprobe names, falling back to container ids', () => {
    expect(normalizeVideoCodec('avc')).toBe('h264');
    expect(normalizeVideoCodec('hevc')).toBe('hevc');
    expect(normalizeVideoCodec('vp8')).toBe('vp8');
    expect(normalizeVideoCodec(null, 'mp4v')).toBe('mpeg4');
    expect(normalizeVideoCodec(null, 'V_MPEG2')).toBe('mpeg2video');
    expect(normalizeVideoCodec(null, 0x02)).toBe('mpeg2video');
    expect(normalizeVideoCodec(null, 'V_WEIRD/THING')).toBe('v_weird_thing');
    expect(normalizeVideoCodec(null, new Uint8Array([1, 2]))).toBe('unknown');
    expect(normalizeVideoCodec(null, null)).toBe('unknown');
  });

  it('normalises audio codecs, including PCM variants', () => {
    expect(normalizeAudioCodec('aac')).toBe('aac');
    expect(normalizeAudioCodec('pcm-s16')).toBe('pcm_s16le');
    expect(normalizeAudioCodec('ulaw')).toBe('pcm_mulaw');
    expect(normalizeAudioCodec(null, 'A_AC3')).toBe('ac3');
    expect(normalizeAudioCodec(null)).toBe('unknown');
  });

  it('reads bit depth from codec strings', () => {
    expect(bitDepthFromCodecString('avc1.64001f')).toBe(8);
    expect(bitDepthFromCodecString('avc1.6e0028')).toBe(10);
    expect(bitDepthFromCodecString('hvc1.1.6.L93.B0')).toBe(8);
    expect(bitDepthFromCodecString('hvc1.2.4.L153.B0')).toBe(10);
    expect(bitDepthFromCodecString('vp09.02.10.10.01.09.16.09.01')).toBe(10);
    expect(bitDepthFromCodecString('av01.0.08M.08')).toBe(8);
    expect(bitDepthFromCodecString('av01.0.12M.10.0.110.09.16.09.0')).toBe(10);
    expect(bitDepthFromCodecString('vp8')).toBe(8);
    expect(bitDepthFromCodecString('mp4a.40.2')).toBeUndefined();
    expect(bitDepthFromCodecString(null)).toBeUndefined();
  });

  it('labels encoders and MIME types', () => {
    expect(encoderLabel('h264')).toBe('WebCodecs H.264');
    expect(encoderLabel('av1', 'realtime')).toBe('WebCodecs AV1 (low-latency)');
    expect(mimeFor('mp4')).toBe('video/mp4');
    expect(mimeFor('webm')).toBe('video/webm');
  });
});

describe('probe mapping', () => {
  it('maps container names', () => {
    expect(containerFromFormatName('MP4')).toBe('mp4');
    expect(containerFromFormatName('QuickTime File Format')).toBe('mov');
    expect(containerFromFormatName('Matroska')).toBe('mkv');
    expect(containerFromFormatName('WebM')).toBe('webm');
    expect(containerFromFormatName('MPEG Transport Stream')).toBe('mpegts');
    expect(containerFromFormatName('Something')).toBe('unknown');
    expect(containerFromFormatName(null)).toBe('unknown');
  });

  it('normalises rotation to clockwise quarter turns', () => {
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(NaN)).toBe(0);
    expect(normalizeRotation(undefined)).toBe(0);
  });

  it('detects HDR from the flag or a PQ/HLG transfer, and uses ffprobe transfer names', () => {
    expect(isHdr(true, null)).toBe(true);
    expect(isHdr(false, { transfer: 'pq' })).toBe(true);
    expect(isHdr(false, { transfer: 'hlg' })).toBe(true);
    expect(isHdr(false, { transfer: 'bt709', primaries: 'bt2020' })).toBe(false);
    expect(transferName('pq')).toBe('smpte2084');
    expect(transferName('hlg')).toBe('arib-std-b67');
    expect(transferName(null)).toBeUndefined();
  });

  it('picks fps from the frame-rate metrics, then the packet rate, else 0 (unknown)', () => {
    expect(pickFps(29.97002997, 30)).toBe(29.97);
    expect(pickFps(null, 25.0001)).toBe(25);
    expect(pickFps(0, NaN)).toBe(0);
  });

  it('builds a full Probe for a landscape H.264 + AAC MP4', () => {
    const p = buildProbe(raw());
    expect(p).toEqual({
      container: 'mp4',
      sizeBytes: 12_345_678,
      durationSec: 10.01,
      video: {
        codec: 'h264',
        decodable: true,
        codedWidth: 1920,
        codedHeight: 1080,
        displayWidth: 1920,
        displayHeight: 1080,
        rotation: 0,
        fps: 29.97,
        frameCount: 300,
        bitrate: 8_000_123,
        hdr: false,
        transfer: 'bt709',
        primaries: 'bt709',
        bitDepth: 8,
      },
      audio: { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 128_400, decodable: true },
    });
  });

  it('keeps display dims for rotated phone video and falls back to swapped coded dims', () => {
    const rotated = buildProbe(raw({ formatName: 'QuickTime File Format', video: video({ rotation: 90, displayWidth: 1080, displayHeight: 1920 }) }));
    expect(rotated.container).toBe('mov');
    expect(rotated.video).toMatchObject({ rotation: 90, displayWidth: 1080, displayHeight: 1920, codedWidth: 1920, codedHeight: 1080 });
    const missing = buildProbe(raw({ video: video({ rotation: 270, displayWidth: 0, displayHeight: 0 }) }));
    expect(missing.video).toMatchObject({ displayWidth: 1080, displayHeight: 1920 });
  });

  it('maps an HDR HEVC 10-bit track, an undecodable codec, and missing tracks', () => {
    const hdr = buildProbe(raw({ video: video({ codec: 'hevc', codecString: 'hvc1.2.4.L153.B0', hdr: false, colorSpace: { primaries: 'bt2020', transfer: 'hlg' } }) }));
    expect(hdr.video).toMatchObject({ codec: 'hevc', hdr: true, transfer: 'arib-std-b67', primaries: 'bt2020', bitDepth: 10 });
    const mpeg2 = buildProbe(raw({ formatName: 'MPEG Transport Stream', video: video({ codec: null, internalCodecId: 0x02, codecString: null, decodable: false }) }));
    expect(mpeg2.video).toMatchObject({ codec: 'mpeg2video', decodable: false });
    expect(mpeg2.video?.bitDepth).toBeUndefined();
    const audioOnly = buildProbe(raw({ video: null, durationSec: NaN }));
    expect(audioOnly.video).toBeNull();
    expect(audioOnly.durationSec).toBe(0);
    expect(buildProbe(raw({ audio: null })).audio).toBeNull();
  });

  it('prefers measured bitrate but falls back to container metadata', () => {
    const p = buildProbe(raw({ video: video({ measuredBitrate: 0, metadataBitrate: 5_000_000 }) }));
    expect(p.video?.bitrate).toBe(5_000_000);
    const none = buildProbe(raw({ video: video({ measuredBitrate: null, metadataBitrate: null, frameCount: null }) }));
    expect(none.video?.bitrate).toBeUndefined();
    expect(none.video?.frameCount).toBeUndefined();
  });
});

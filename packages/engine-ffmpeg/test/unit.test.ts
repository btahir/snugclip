// Pure parts of the ffmpeg engine: ffprobe mapping, encoder choice, argv, progress parsing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EncodePlan } from '@snugclip/core';
import { buildArgs, buildCapabilities, candidates, clockwiseRotation, containerName, frameDims, installHint, mapFfprobe, parseList, parseProgress, parseRate, parseSummary, pickEncoders, videoFilter } from '../src/index.js';
import { candidates as cand } from '../src/detect.js';

const probeJson = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, 'ffprobe', `${name}.json`), 'utf8'));

describe('ffprobe → Probe', () => {
  it('F06: 90° display matrix → 1080x1920 portrait, clockwise 270', () => {
    const p = mapFfprobe(probeJson('f06-rotated-1080p-10s'), 'f06.mp4', 5_261_728);
    expect(p).toMatchObject({ container: 'mp4', durationSec: 10, sizeBytes: 5_261_728 });
    expect(p.video).toMatchObject({ codec: 'h264', codedWidth: 1920, codedHeight: 1080, displayWidth: 1080, displayHeight: 1920, rotation: 270, fps: 30, hdr: false, frameCount: 300 });
    expect(p.audio).toMatchObject({ codec: 'aac', channels: 2, sampleRate: 48000 });
    expect(p.audio!.bitrate).toBeGreaterThan(100_000);
  });
  it('F13: HDR10 HEVC in MOV', () => {
    const p = mapFfprobe(probeJson('f13-hdr-pq-hevc-1080p-5s'), 'f13.mov', 1);
    expect(p.container).toBe('mov');
    expect(p.video).toMatchObject({ codec: 'hevc', hdr: true, transfer: 'smpte2084', primaries: 'bt2020', bitDepth: 10 });
  });
  it('F09: VP9/Opus WebM (no stream bitrates)', () => {
    const p = mapFfprobe(probeJson('f09-vp9-720p30-10s'), 'f09.webm', 1);
    expect(p.container).toBe('webm');
    expect(p.video).toMatchObject({ codec: 'vp9', displayWidth: 1280, displayHeight: 720 });
    expect(p.audio?.codec).toBe('opus');
  });
  it('F15: MPEG-2 program stream decodes on the CLI', () => {
    const p = mapFfprobe(probeJson('f15-mpeg2-240p-2s'), 'f15.mpg', 1);
    expect(p.container).toBe('mpeg');
    expect(p.video).toMatchObject({ codec: 'mpeg2video', decodable: true, fps: 25 });
  });
  it('F16 audio-only and images are unsupported', () => {
    expect(() => mapFfprobe(probeJson('f16-audio-only'), 'f16.m4a', 1)).toThrow(expect.objectContaining({ code: 'E_UNSUPPORTED', message: 'This file has only audio, no video track.' }));
    expect(() => mapFfprobe({ format: { format_name: 'png_pipe', duration: '0.04' }, streams: [{ codec_type: 'video', codec_name: 'png', width: 10, height: 10 }] }, 'x.png', 1)).toThrow(expect.objectContaining({ code: 'E_UNSUPPORTED' }));
    expect(() => mapFfprobe({ format: { format_name: 'mov,mp4' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 10 }] }, 'x.mp4', 1)).toThrow(/duration/);
  });
  it('rotation, SAR, rates, container names', () => {
    expect(clockwiseRotation({ side_data_list: [{ rotation: -90 }] })).toBe(90);
    expect(clockwiseRotation({ side_data_list: [{ rotation: 180 }] })).toBe(180);
    expect(clockwiseRotation({ tags: { rotate: '90' } })).toBe(90);
    expect(clockwiseRotation({})).toBe(0);
    const anamorphic = mapFfprobe({ format: { format_name: 'matroska,webm', duration: '5' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1440, height: 1080, sample_aspect_ratio: '4:3', avg_frame_rate: '30000/1001' }] }, 'x.mkv', 1);
    expect(anamorphic.video).toMatchObject({ displayWidth: 1920, displayHeight: 1080, fps: 29.97 });
    expect(anamorphic.container).toBe('mkv');
    expect(parseRate('0/0')).toBe(0);
    expect(containerName('mov,mp4,m4a,3gp,3g2,mj2', 'a.MP4', 'isom')).toBe('mp4');
    expect(containerName('mov,mp4,m4a,3gp,3g2,mj2', 'a.bin', 'qt  ')).toBe('mov');
  });
});

describe('encoders and capabilities', () => {
  const all = new Set(['libx264', 'h264_videotoolbox', 'libopenh264', 'libx265', 'hevc_videotoolbox', 'libsvtav1', 'libvpx-vp9', 'aac', 'libopus']);
  it('prefers libx264 two-pass, then videotoolbox, then openh264', () => {
    expect(pickEncoders(all)).toEqual({ h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9' });
    expect(pickEncoders(new Set(['h264_videotoolbox', 'libopenh264'])).h264).toBe('h264_videotoolbox');
    expect(pickEncoders(new Set(['libopenh264'])).h264).toBe('libopenh264');
    expect(pickEncoders(all, 'h264_videotoolbox').h264).toBe('h264_videotoolbox');
    expect(pickEncoders(all, 'nonsense').h264).toBe('libx264');
  });
  it('builds capabilities with margins and calibration hints', () => {
    const c = buildCapabilities('8.1', all);
    expect(c).toMatchObject({ id: 'ffmpeg', twoPass: true, initialMargin: 0.02, twoPassCodecs: ['h264', 'hevc', 'vp9'], rateCalibration: 'auto', audioCopyWithTrim: true, audioCodecs: ['aac', 'opus'] });
    expect(c.marginByCodec).toMatchObject({ h264: 0.02, av1: 0.04 });
    const vt = buildCapabilities('8.1', all, 'h264_videotoolbox');
    expect(vt).toMatchObject({ twoPass: false, initialMargin: 0.04, maxEncodeShortSide: { h264: 2160 } });
    expect(buildCapabilities('x', new Set(['libopenh264'])).videoCodecs).toEqual(['h264']);
  });
  it('parses -encoders / -filters tables', () => {
    const text = ' V....D libx264              libx264 H.264\n A....D aac                  AAC\n ------\n TS zscale            V->V       Apply resizing\n .. anoisesrc         |->A       Generate';
    expect([...parseList(text)]).toEqual(['libx264', 'aac', 'zscale', 'anoisesrc']);
  });
  it('install hints per OS and binary search order', () => {
    expect(installHint('darwin')).toContain('brew install ffmpeg');
    expect(installHint('win32')).toContain('winget install Gyan.FFmpeg');
    expect(installHint('linux')).toContain('apt install ffmpeg');
    expect(cand('ffmpeg', '/x/ff', {}, 'darwin')).toEqual(['/x/ff']);
    expect(cand('ffprobe', undefined, { SNUGCLIP_FFPROBE: '/y/fp' }, 'darwin')).toEqual(['/y/fp']);
    expect(candidates('ffmpeg', undefined, { PATH: '/a:/b' }, 'darwin')).toEqual(['/a/ffmpeg', '/b/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']);
  });
});

const plan = (over: Partial<EncodePlan<string>> = {}): EncodePlan<string> => ({
  input: 'in.mov',
  purpose: 'full',
  container: 'mp4',
  video: { codec: 'h264', width: 1280, height: 720, fps: 30, bitrate: 2_000_000, keyframeIntervalSec: 2 },
  audio: { mode: 'encode', codec: 'aac', bitrate: 96_000, channels: 2, sampleRate: 48000, bytes: 1 },
  hdrToSdr: false,
  ...over,
});
const ctx = { input: 'in.mov', output: 'out.mp4.snugclip-1-1.tmp', encoder: 'libx264' as const, pass: 2 as const, passlog: 'pl', sourceFps: 60, threads: 4, tonemap: false, opusEncoder: 'libopus' as const, nullSink: '/dev/null' };

describe('argv', () => {
  it('libx264 pass 2 (PLAN §8.1 shape)', () => {
    expect(buildArgs(plan({ trim: { startSec: 1.5, endSec: 9.25 } }), ctx).join(' ')).toBe(
      '-hide_banner -nostdin -y -loglevel info -nostats -ss 1.500 -t 7.750 -i in.mov -map 0:v:0 -vf scale=1280:720:flags=lanczos,fps=30,format=yuv420p ' +
        '-c:v libx264 -preset medium -profile:v high -b:v 2000k -maxrate 3000k -bufsize 4000k -g 60 -pass 2 -passlogfile pl ' +
        '-map 0:a:0 -b:a 96k -ac 2 -ar 48000 -c:a aac -movflags +faststart -map_metadata -1 -map_chapters -1 -max_muxing_queue_size 4096 -threads 4 -progress pipe:1 -f mp4 out.mp4.snugclip-1-1.tmp',
    );
  });
  it('pass 1 goes to the null sink without audio', () => {
    const a = buildArgs(plan(), { ...ctx, pass: 1 });
    expect(a.slice(-8)).toEqual(['-an', '-threads', '4', '-progress', 'pipe:1', '-f', 'null', '/dev/null']);
    expect(a).not.toContain('-c:a');
  });
  it('audio copy / none / opus; other encoders', () => {
    expect(buildArgs(plan({ audio: { mode: 'copy', codec: 'aac', bitrate: 96_000, channels: 2, sampleRate: 44100, bytes: 1 } }), ctx).join(' ')).toContain('-map 0:a:0 -c:a copy');
    expect(buildArgs(plan({ audio: { mode: 'none', bytes: 0 } }), ctx)).toContain('-an');
    const webm = buildArgs(plan({ container: 'webm', video: { ...plan().video, codec: 'vp9' }, audio: { mode: 'encode', codec: 'opus', bitrate: 64_000, channels: 2, sampleRate: 48000, bytes: 1 } }), { ...ctx, encoder: 'libvpx-vp9' }).join(' ');
    expect(webm).toContain('-c:v libvpx-vp9');
    expect(webm).toContain('-c:a libopus');
    expect(webm).toContain('-f webm');
    expect(webm).not.toContain('faststart');
    expect(buildArgs(plan(), { ...ctx, encoder: 'h264_videotoolbox', pass: null }).join(' ')).toContain('-c:v h264_videotoolbox -b:v 2000k -maxrate 3000k -bufsize 4000k -profile:v high');
    expect(buildArgs(plan(), { ...ctx, encoder: 'libx265', pass: 1 }).join(' ')).toContain('pass=1:stats=pl:log-level=error:vbv-maxrate=3000:vbv-bufsize=4000:keyint=60');
    expect(buildArgs(plan(), { ...ctx, encoder: 'libsvtav1', pass: null }).join(' ')).toContain('-c:v libsvtav1 -b:v 2000k -preset 8 -g 60 -svtav1-params rc=1');
    expect(buildArgs(plan(), { ...ctx, encoder: 'libopenh264', pass: null }).join(' ')).toContain('-c:v libopenh264 -rc_mode bitrate');
  });
  it('video filter: fps only when it changes; HDR tone-map only with zscale', () => {
    expect(videoFilter(plan(), { sourceFps: 30, tonemap: false })).toBe('scale=1280:720:flags=lanczos,format=yuv420p');
    expect(videoFilter(plan({ hdrToSdr: true }), { sourceFps: 30, tonemap: false })).toBe('scale=1280:720:flags=lanczos,format=yuv420p');
    expect(videoFilter(plan({ hdrToSdr: true }), { sourceFps: 30, tonemap: true })).toMatch(/^zscale=t=linear.*tonemap=hable.*scale=1280:720/);
  });
  it('frame dims keep display orientation and may upscale to the eval side', () => {
    expect(frameDims(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(frameDims(854, 480, 720)).toEqual({ width: 1282, height: 720 });
    expect(frameDims(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
  });
  it('progress and summary parsing', () => {
    expect(parseProgress('frame=10\nout_time_us=1500000\nout_time_ms=2500000\nprogress=continue\n')).toBe(2.5);
    expect(parseProgress('frame=10\n')).toBeNull();
    expect(parseSummary('[out#0/mp4 @ 0x1] video:59KiB audio:17KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: 4.5%')).toEqual({ videoBytes: 59 * 1024, audioBytes: 17 * 1024 });
    expect(parseSummary('nothing')).toEqual({});
  });
});

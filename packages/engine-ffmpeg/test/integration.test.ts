// Real ffmpeg on a tiny synthetic clip (light: 3 s at 320x240).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFit, resolveTarget } from '@snugclip/core';
import { FfmpegEngine, clearDetectCache, detectFfmpeg } from '../src/index.js';

let dir: string;
let clip: string;
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const leftovers = () => readdirSync(dir).filter((f) => f.includes('.snugclip-'));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'snugclip-ff-'));
  clip = join(dir, 'clip.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-b:v', '800k', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-threads', '4', clip]);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const engine = (over: ConstructorParameters<typeof FfmpegEngine>[0] = {}) =>
  new FfmpegEngine({ outputFor: (i, ext) => join(dir, `${basename(i, '.mp4')}-out.${ext}`), ...over });
const deps = (signal = new AbortController().signal) => ({ now: Date.now, signal, inputName: 'clip.mp4' });

describe('ffmpeg engine (real ffmpeg)', () => {
  it('detects ffmpeg and its encoders', async () => {
    const e = engine();
    const caps = await e.capabilities();
    expect(caps.videoCodecs).toContain('h264');
    expect(caps.audioCodecs).toContain('aac');
    expect(caps.encoderName.h264).toBe('libx264');
  });
  it('probes', async () => {
    const p = await engine().probe(clip);
    expect(p).toMatchObject({ container: 'mp4', durationSec: 3, video: { codec: 'h264', displayWidth: 320, displayHeight: 240, fps: 30 }, audio: { codec: 'aac' } });
  });
  it('fits a tight target, commits to the final path, leaves no temp files', async () => {
    const e = engine();
    const target = resolveTarget({ size: '120KB' });
    const r = await runFit(e, clip, target, {}, deps());
    expect(r.status).toBe('fit');
    expect(r.output!.bytes).toBeLessThanOrEqual(120_000);
    expect(r.outputRef!.committed).toBe(true);
    expect(statSync(r.outputRef!.path).size).toBe(r.output!.bytes);
    expect(r.quality!.frames).toBe(10);
    expect(r.quality!.ssimMean).toBeGreaterThan(0.5);
    expect(r.attempts[0]!.videoBytes).toBeGreaterThan(0);
    expect(leftovers()).toEqual([]);
    ffprobeDecodesCleanly(r.outputRef!.path);
    rmSync(r.outputRef!.path);
  });
  it('pass-through copies byte-identically', async () => {
    const r = await runFit(engine(), clip, resolveTarget({ size: '10MB' }), {}, deps());
    expect(r.status).toBe('passthrough');
    expect(sha(r.outputRef!.path)).toBe(sha(clip));
    rmSync(r.outputRef!.path);
  });
  it('refuses to overwrite an existing output (E_EXISTS) and cleans its temp', async () => {
    const existing = join(dir, 'clip-out.mp4');
    writeFileSync(existing, 'keep me');
    const r = await runFit(engine(), clip, resolveTarget({ size: '150KB' }), {}, deps());
    expect(r.status).toBe('error');
    expect(r.error?.code).toBe('E_EXISTS');
    expect(readFileSync(existing, 'utf8')).toBe('keep me');
    expect(leftovers()).toEqual([]);
    const ok = await runFit(engine({ overwrite: true }), clip, resolveTarget({ size: '150KB' }), {}, deps());
    expect(ok.status).toBe('fit');
    rmSync(existing);
  });
  it('cancels mid-encode without leftovers', async () => {
    const ac = new AbortController();
    const e = engine();
    const r = await runFit(e, clip, resolveTarget({ size: '100KB' }), {}, {
      ...deps(ac.signal),
      onProgress: (p) => {
        if (p.phase === 'encoding' && p.overall > 0.05) ac.abort();
      },
    });
    expect(r.status).toBe('cancelled');
    expect(leftovers()).toEqual([]);
  });
  it('returns RGBA frames at the eval size', async () => {
    const f = await engine().frames(clip, [0.5, 2.5], 180, new AbortController().signal);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ width: 240, height: 180 });
    expect(f[0]!.data.length).toBe(240 * 180 * 4);
  });
  it('unsupported: garbage and audio-only files', async () => {
    const junk = join(dir, 'junk.mp4');
    writeFileSync(junk, Buffer.alloc(4096, 7));
    const r = await runFit(engine(), junk, resolveTarget({ size: '1MB' }), {}, deps());
    expect(r).toMatchObject({ status: 'unsupported', error: { code: 'E_UNSUPPORTED' } });
  });
  it('missing ffmpeg → E_FFMPEG_MISSING with an install hint', () => {
    clearDetectCache();
    expect(() => detectFfmpeg({ env: { SNUGCLIP_FFMPEG: '/nonexistent/ffmpeg', SNUGCLIP_FFPROBE: '/nonexistent/ffprobe', PATH: '' }, platform: 'darwin' })).toThrow(
      expect.objectContaining({ code: 'E_FFMPEG_MISSING', hint: expect.stringContaining('brew install ffmpeg') }),
    );
  });
});

function ffprobeDecodesCleanly(p: string) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  expect(out.trim()).toBe('');
}

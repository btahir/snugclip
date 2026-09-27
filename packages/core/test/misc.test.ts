import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JOB_SCHEMA_V1,
  PRESETS,
  SITE_URL,
  SUPPORT_URL,
  analysisSize,
  compareFrames,
  createJob,
  deepLinkUrl,
  exitCodeFor,
  getPreset,
  parseCodec,
  parseDeepLink,
  parseFps,
  parseJob,
  parseTime,
  psnr,
  qualityVerdict,
  resolveTarget,
  sampleTimes,
  serializeDeepLink,
  serializeJob,
  ssim,
  validateJob,
} from '../src/index.js';

function pattern(w: number, h: number, seed = 1): Uint8Array {
  const a = new Uint8Array(w * h);
  let s = seed;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      a[y * w + x] = ((x * 3 + y * 5) % 200) + (s % 40);
    }
  return a;
}

describe('quality', () => {
  const w = 96;
  const h = 64;
  it('identical frames: SSIM 1, PSNR 100', () => {
    const a = pattern(w, h);
    expect(ssim(a, a, w, h)).toBeCloseTo(1, 10);
    expect(psnr(a, a, w, h)).toBe(100);
  });
  it('SSIM falls as distortion grows', () => {
    const a = pattern(w, h);
    const mild = a.map((v, i) => Math.min(255, v + ((i * 7) % 5) - 2));
    const heavy = a.map((v, i) => Math.min(255, Math.max(0, v + ((i * 7919) % 81) - 40)));
    const blur = a.map((_, i) => (a[i]! + (a[i + 1] ?? a[i]!) + (a[i - 1] ?? a[i]!)) / 3);
    const sMild = ssim(a, mild, w, h);
    const sHeavy = ssim(a, heavy, w, h);
    expect(sMild).toBeGreaterThan(0.9);
    expect(sHeavy).toBeLessThan(sMild);
    expect(ssim(a, Uint8Array.from(blur), w, h)).toBeLessThan(1);
    expect(psnr(a, heavy, w, h)).toBeLessThan(psnr(a, mild, w, h));
  });
  it('a uniform shift keeps structure (SSIM high) but lowers PSNR', () => {
    const a = pattern(w, h);
    const shifted = a.map((v) => Math.min(255, v + 10));
    expect(ssim(a, shifted, w, h)).toBeGreaterThan(0.95);
    expect(psnr(a, shifted, w, h)).toBeCloseTo(28.13, 1);
  });
  it('compareFrames aggregates mean/min', () => {
    const a = pattern(w, h, 1);
    const b = pattern(w, h, 2);
    const m = compareFrames(
      [
        { source: a, output: a },
        { source: a, output: b },
      ],
      w,
      h,
    );
    expect(m.frames).toBe(2);
    expect(m.ssimMin).toBeLessThan(m.ssimMean);
    expect(m.ssimMean).toBeLessThan(1);
  });
  it('verdict thresholds', () => {
    expect(qualityVerdict(0.97)).toEqual({ verdict: 'great', label: 'Looks great' });
    expect(qualityVerdict(0.92)).toEqual({ verdict: 'softer', label: 'Softer, still clear' });
    expect(qualityVerdict(0.8)).toEqual({ verdict: 'soft', label: 'Noticeably soft' });
  });
  it('analysisSize caps the shorter side at 720 and keeps even dims', () => {
    expect(analysisSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(analysisSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(analysisSize(854, 480)).toEqual({ width: 854, height: 480 });
  });
  it('sampleTimes are evenly spaced inside the clip', () => {
    expect(sampleTimes(10, 4)).toEqual([1.25, 3.75, 6.25, 8.75]);
  });
});

describe('presets', () => {
  it('every platform preset cites a source and a check date', () => {
    for (const p of PRESETS.filter((x) => x.group === 'platform')) {
      expect(p.sourceUrl, p.id).toMatch(/^https:\/\//);
      expect(p.checked, p.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('ids and aliases are unique', () => {
    const keys = PRESETS.flatMap((p) => [p.id, ...p.aliases]);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('lookup by alias, case-insensitive', () => {
    expect(getPreset('Discord')?.id).toBe('discord-free');
    expect(getPreset('8')?.bytes).toBe(8_000_000);
    expect(getPreset('nope')).toBeNull();
  });
  it('generic sizes are exact decimal MB', () => {
    expect(['8mb', '10mb', '25mb', '50mb', '100mb'].map((id) => getPreset(id)!.bytes)).toEqual([8e6, 10e6, 25e6, 50e6, 100e6]);
  });
});

describe('options parsing', () => {
  it('resolveTarget', () => {
    expect(resolveTarget({ size: '10MB' })).toEqual({ bytes: 10_000_000, label: '10 MB' });
    expect(resolveTarget({ preset: 'discord' })).toMatchObject({ bytes: 10_000_000, presetId: 'discord-free' });
    expect(resolveTarget({ size: '9MB', preset: 'discord' }).bytes).toBe(9_000_000);
    expect(() => resolveTarget({})).toThrow(/Give a target/);
    expect(() => resolveTarget({ preset: 'myspace' })).toThrow(/Unknown preset/);
    expect(() => resolveTarget({ size: '5KB' })).toThrow(/too small/);
  });
  it('parseCodec / parseFps / parseTime', () => {
    expect(parseCodec('H.265')).toBe('hevc');
    expect(parseCodec('Smaller')).toBe('smaller');
    expect(() => parseCodec('mpeg2')).toThrow();
    expect(parseFps('30')).toBe(30);
    expect(parseFps('keep')).toBe('keep');
    expect(() => parseFps('0')).toThrow();
    expect(parseTime('1:05')).toBe(65);
    expect(parseTime('1:02:03.5')).toBe(3723.5);
    expect(parseTime('12.25')).toBe(12.25);
    expect(() => parseTime('1:xx')).toThrow();
  });
  it('exit codes are stable', () => {
    expect([null, 'IMPOSSIBLE_TARGET', 'UNSUPPORTED_INPUT', 'FFMPEG_MISSING', 'ENCODE_FAILED', 'COULD_NOT_FIT'].map((c) => exitCodeFor(c as never))).toEqual([0, 2, 3, 4, 1, 1]);
  });
});

describe('job file v1', () => {
  it('round-trips: create → serialize → parse → serialize is identical', () => {
    const job = createJob(resolveTarget({ preset: 'discord' }), { codec: 'smaller', maxHeight: 720, fps: 30, trim: { start: 1.5, end: 12 }, mute: true }, { inputs: ['a.mp4'], note: 'for Sam' });
    const text = serializeJob(job);
    const back = parseJob(text);
    expect(back).toEqual(job);
    expect(serializeJob(back)).toBe(text);
  });
  it('accepts authoring shortcuts (size string, preset alias) and fills defaults', () => {
    const job = parseJob(JSON.stringify({ kind: 'snugclip.job', version: 1, target: { size: '25MB' } }));
    expect(job.target.bytes).toBe(25_000_000);
    expect(job.options).toEqual({ codec: 'compatible', maxHeight: null, fps: 'auto', trim: null, mute: false, reencode: false });
    expect(parseJob(JSON.stringify({ kind: 'snugclip.job', version: 1, target: { preset: 'whatsapp' } })).target.presetId).toBe('whatsapp');
  });
  it('checks the schema version', () => {
    expect(() => parseJob(JSON.stringify({ kind: 'snugclip.job', version: 2, target: { size: '8MB' } }))).toThrow(/newer than this Snugclip/);
    expect(() => parseJob(JSON.stringify({ kind: 'snugclip.job', target: { size: '8MB' } }))).toThrow(/version must be 1/);
  });
  it('reports every problem at once', () => {
    const r = validateJob({ kind: 'x', version: 1, target: {}, options: { codec: 'mpeg2', fps: -1, bogus: 1 }, extra: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toMatchInlineSnapshot(`
        "unknown field "extra"
        kind must be "snugclip.job"
        target: target needs bytes, size or presetId
        options: unknown field "bogus"
        options.codec must be one of compatible, smaller, h264, hevc, av1, vp9
        options.fps must be "auto", "keep" or a number in (0, 240]"
      `);
    }
  });
  it('rejects non-JSON', () => {
    expect(() => parseJob('{nope')).toThrow(/not valid JSON/);
  });
  it('publishes a JSON schema with the same version', () => {
    expect(JOB_SCHEMA_V1.properties.version.const).toBe(1);
    expect(JOB_SCHEMA_V1.$id).toBe(`${SITE_URL}/schema/job-v1.json`);
  });
});

describe('deep links', () => {
  it('parses the brief example', () => {
    const s = parseDeepLink('/?preset=discord&codec=h264&maxh=720');
    expect(s.target).toMatchObject({ bytes: 10_000_000, presetId: 'discord-free' });
    expect(s.options).toEqual({ codec: 'h264', maxHeight: 720 });
    expect(s.errors).toEqual([]);
  });
  it('size beats preset regardless of order; bad params are reported and skipped', () => {
    const s = parseDeepLink('?size=9.5MB&preset=discord&fps=abc&trim=2-1:05&mute=1&utm_source=x');
    expect(s.target?.bytes).toBe(9_500_000);
    expect(s.options).toEqual({ trim: { start: 2, end: 65 }, mute: true });
    expect(s.errors).toHaveLength(1);
  });
  it('round-trips through serialize', () => {
    const target = resolveTarget({ preset: 'whatsapp' });
    const options = { codec: 'smaller' as const, maxHeight: 540, fps: 24, mute: true, trim: { start: 1.25, end: 9 }, reencode: true };
    const q = serializeDeepLink(target, options);
    expect(q).toBe('?preset=whatsapp&codec=smaller&maxh=540&fps=24&mute=1&trim=1.25-9&reencode=1');
    const back = parseDeepLink(q);
    expect(back.target).toEqual(target);
    expect(back.options).toEqual(options);
  });
  it('omits defaults and builds a full URL', () => {
    expect(serializeDeepLink(null, { codec: 'compatible', fps: 'auto' })).toBe('');
    expect(deepLinkUrl(resolveTarget({ size: '8MB' }))).toBe(`${SITE_URL}/?size=8MB`);
  });
});

describe('purity: core has no DOM or Node dependencies', () => {
  const dir = join(import.meta.dirname, '..', 'src');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  it.each(files)('%s imports nothing outside the package and uses no host globals', (f) => {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(/^\.\//);
    expect(src).not.toMatch(/\b(window|document|navigator|process|Buffer|require|globalThis|self|setTimeout|fetch|URLSearchParams)\b/);
  });
  it('no Stripe URLs in core and support URL points at the site', () => {
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/stripe\.com/);
    expect(SUPPORT_URL).toBe('https://snugclip.vercel.app/support/');
  });
});

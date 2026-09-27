// E1/E2/E4/G4: CLI goldens, exit codes, support line, job files. Runs main() in-process against
// the real system ffmpeg and the PLAN §12 fixtures (generate with `pnpm fixtures`).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CliEnvelopeSchema, PlanResultSchema, PresetSchema, ProbeResultSchema, ReportSchema, SUPPORT_URL, parseJob } from '@snugclip/core';
import { main, type Io } from '../src/main.js';

const FX = join(import.meta.dirname, '../../../fixtures/generated');
const fx = (name: string) => join(FX, readdirSync(FX).find((f) => f.startsWith(name.toLowerCase()))!);
const haveFixtures = existsSync(FX) && readdirSync(FX).some((f) => f.startsWith('f17'));
const d = haveFixtures ? describe : describe.skip;

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'snugclip-cli-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

async function cli(args: string[], env: Record<string, string | undefined> = {}) {
  let stdout = '';
  let stderr = '';
  const io: Io = {
    stdout: (s) => void (stdout += s),
    stderr: (s) => void (stderr += s),
    env: { PATH: process.env.PATH, SNUGCLIP_FIXED_CLOCK: '2026-01-01T00:00:00Z', ...env },
    cwd: work,
    isTTY: false,
  };
  const code = await main(args, io);
  return { code, stdout, stderr, json: () => JSON.parse(stdout) };
}

/** Strips volatile fields (paths, timings, encoder versions, output bytes) for goldens. */
function normalize(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v, (k, val) => {
      if (k === 'path' || k === 'input') return typeof val === 'string' ? val.replace(/^.*\//, '<dir>/') : val;
      if (k === 'elapsedMs') return 0;
      if (k === 'version' && typeof val === 'string') return '<v>';
      return val;
    }),
  );
}

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const tmpLeft = () => readdirSync(work).filter((f) => f.includes('.snugclip-'));

describe('cli basics (no ffmpeg needed)', () => {
  it('presets --json matches the golden and the schema', async () => {
    const r = await cli(['presets', '--json']);
    expect(r.code).toBe(0);
    const doc = r.json();
    expect(CliEnvelopeSchema.parse(doc).snugclip).toBe('presets');
    for (const p of doc.results) PresetSchema.parse(p);
    await expect(JSON.stringify(doc, null, 2) + '\n').toMatchFileSnapshot('./golden/presets.json');
  });
  it('bad flag → 1 (E_ARGS), JSON error envelope', async () => {
    const r = await cli(['compress', 'x.mp4', '--size', '10MB', '--bogus', '--json']);
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ snugclip: 'compress', version: 1, error: { code: 'E_ARGS' } });
    expect((await cli(['frobnicate'])).code).toBe(1);
    expect((await cli(['compress', 'x.mp4', '--size', 'banana'])).code).toBe(1);
  });
  it('--help and --version', async () => {
    expect((await cli(['--help'])).stdout).toContain('Exit codes: 0 fits');
    expect((await cli(['--version'])).stdout).toMatch(/^snugclip \d+\.\d+\.\d+/);
  });
  it('missing ffmpeg → 4 with an install hint', async () => {
    const r = await cli(['probe', 'x.mp4'], { SNUGCLIP_FFMPEG: '/nonexistent/ffmpeg', SNUGCLIP_FFPROBE: '/nonexistent/ffprobe', PATH: '' });
    expect(r.code).toBe(4);
    expect(r.stderr).toContain(process.platform === 'darwin' ? 'brew install ffmpeg' : 'install');
    const j = await cli(['compress', 'x.mp4', '--size', '10MB', '--json'], { SNUGCLIP_FFMPEG: '/nonexistent/ffmpeg', SNUGCLIP_FFPROBE: '/nonexistent/ffprobe', PATH: '' });
    expect(j.code).toBe(4);
    expect(j.json().error.code).toBe('E_FFMPEG_MISSING');
  });
});

d('cli with ffmpeg and fixtures', () => {
  it('probe F01 F06 F08 --json (golden)', async () => {
    const r = await cli(['probe', fx('F01'), fx('F06'), fx('F08'), '--json']);
    expect(r.code).toBe(0);
    const doc = r.json();
    for (const x of doc.results) ProbeResultSchema.parse(x);
    expect(doc.results[1].probe.video).toMatchObject({ displayWidth: 1080, displayHeight: 1920, rotation: 270 });
    await expect(JSON.stringify(normalize(doc), null, 2) + '\n').toMatchFileSnapshot('./golden/probe.json');
  });
  it('plan F01 --preset discord --json (golden; already fits → pass-through)', async () => {
    const r = await cli(['plan', fx('F01'), '--preset', 'discord', '--json']);
    expect(r.code).toBe(0);
    const doc = r.json();
    PlanResultSchema.parse(doc.results[0]);
    expect(doc.results[0].plan).toMatchObject({ feasible: true, passThrough: true, targetBytes: 20_000_000 });
    await expect(JSON.stringify(normalize(doc), null, 2) + '\n').toMatchFileSnapshot('./golden/plan-f01-discord.json');
  });
  it('plan F11 --size 0.5MB → exit 2 with minimumBytes', async () => {
    const r = await cli(['plan', fx('F11'), '--size', '0.5MB', '--json']);
    expect(r.code).toBe(2);
    const p = r.json().results[0].plan;
    expect(p.feasible).toBe(false);
    expect(p.minimumBytes).toBeGreaterThan(500_000);
    await expect(JSON.stringify(normalize(r.json()), null, 2) + '\n').toMatchFileSnapshot('./golden/plan-f11-0.5MB.json');
  });
  it('compress F03 --size 2MB --json: fits, schema-valid, no temp files', async () => {
    const r = await cli(['compress', fx('F03'), '--size', '2MB', '--out-dir', work, '--json']);
    expect(r.code).toBe(0);
    const rep = r.json().results[0];
    ReportSchema.parse(rep);
    expect(rep).toMatchObject({ status: 'fit', fits: true, createdAt: '2026-01-01T00:00:00.000Z', elapsedMs: 0 });
    expect(rep.output.bytes).toBeLessThanOrEqual(2_000_000);
    expect(statSync(rep.output.path).size).toBe(rep.output.bytes);
    expect(rep.quality.frames).toBe(10);
    expect(tmpLeft()).toEqual([]);
    const stable = { ...rep, output: { ...rep.output, bytes: '<≤ target>', video: { ...rep.output.video, bitrate: '<attempt>' } }, attempts: rep.attempts.map((a: { rung: unknown; purpose: string; fits: boolean }) => ({ purpose: a.purpose, rung: a.rung, fits: a.fits })), quality: { verdict: rep.quality.verdict } };
    await expect(JSON.stringify(normalize(stable), null, 2) + '\n').toMatchFileSnapshot('./golden/compress-f03-2MB.json');
  });
  it('F12 pass-through → 0 with a byte-identical copy', async () => {
    const r = await cli(['compress', fx('F12'), '--size', '10MB', '--out-dir', work, '--json']);
    expect(r.code).toBe(0);
    const rep = r.json().results[0];
    expect(rep.status).toBe('passthrough');
    expect(sha(rep.output.path)).toBe(sha(fx('F12')));
  });
  it('impossible → 2; F16 audio-only and F17 garbage → 3; batch {F01, F16} → 3', async () => {
    const imp = await cli(['compress', fx('F11'), '--size', '0.5MB', '--out-dir', work, '--json']);
    expect(imp.code).toBe(2);
    expect(imp.json().results[0]).toMatchObject({ status: 'impossible', error: { code: 'E_IMPOSSIBLE' } });
    expect(imp.json().results[0].minimumBytes).toBeGreaterThan(500_000);
    expect((await cli(['compress', fx('F16'), '--size', '1MB', '--out-dir', work])).code).toBe(3);
    const garbage = await cli(['compress', fx('F17'), '--size', '1MB', '--out-dir', work, '--json']);
    expect(garbage.code).toBe(3);
    expect(garbage.json().results[0].error.code).toBe('E_UNSUPPORTED');
    const batch = await cli(['compress', fx('F01'), fx('F16'), '--size', '1MB', '--out-dir', work, '--json', '--overwrite']);
    expect(batch.code).toBe(3);
    expect(batch.json().results.map((x: { status: string }) => x.status)).toEqual(['fit', 'unsupported']);
  });
  it('existing output without --overwrite → 1 (E_EXISTS), file untouched', async () => {
    const out = join(work, 'exists.mp4');
    writeFileSync(out, 'precious');
    const r = await cli(['compress', fx('F07'), '--size', '1MB', '-o', out, '--json']);
    expect(r.code).toBe(1);
    expect(r.json().results[0].error.code).toBe('E_EXISTS');
    expect(readFileSync(out, 'utf8')).toBe('precious');
    expect(tmpLeft()).toEqual([]);
  });
  it('support line: exactly one stderr line in human mode; none with --no-support, --json or SNUGCLIP_NO_SUPPORT', async () => {
    const count = (s: string) => s.split('\n').filter((l) => l.includes(SUPPORT_URL)).length;
    const human = await cli(['compress', fx('F12'), '--size', '10MB', '--out-dir', work, '--overwrite']);
    expect(human.code).toBe(0);
    expect(count(human.stderr)).toBe(1);
    expect(count(human.stdout)).toBe(0);
    expect(human.stdout).toMatch(/^passthrough/);
    expect(count((await cli(['compress', fx('F12'), '--size', '10MB', '--out-dir', work, '--overwrite', '--no-support'])).stderr)).toBe(0);
    expect(count((await cli(['compress', fx('F12'), '--size', '10MB', '--out-dir', work, '--overwrite', '--json'])).stderr)).toBe(0);
    expect(count((await cli(['compress', fx('F12'), '--size', '10MB', '--out-dir', work, '--overwrite'], { SNUGCLIP_NO_SUPPORT: '1' })).stderr)).toBe(0);
  });
  it('--job + --save-job: saved job = input job + reports; flags override job values', async () => {
    cpSync(fx('F07'), join(work, 'clip.mp4'));
    const job = { snugclip: 'job', version: 1, target: { preset: 'size-8' }, options: { mute: true, maxShortSide: 480 }, inputs: ['clip.mp4'], output: { dir: 'out/' } };
    writeFileSync(join(work, 'j.snugclip.json'), JSON.stringify(job));
    const r = await cli(['compress', '--job', 'j.snugclip.json', '--save-job', 'saved.snugclip.json', '--size', '0.8MB', '--json']);
    expect(r.code).toBe(0);
    const rep = r.json().results[0];
    expect(rep.target.bytes).toBe(800_000);
    expect(rep.plan.audio.mode).toBe('none');
    expect(rep.output.video.height).toBeLessThanOrEqual(854);
    expect(rep.output.path).toContain('/out/');
    const saved = parseJob(readFileSync(join(work, 'saved.snugclip.json'), 'utf8'));
    const { reports, ...rest } = saved;
    expect(rest).toEqual(job);
    expect(reports).toHaveLength(1);
    expect(reports![0]!.fits).toBe(true);
  });
  it('directories expand to their videos (non-recursive)', async () => {
    const r = await cli(['probe', FX, '--json']);
    const names = r.json().results.map((x: { input: string }) => x.input.replace(/^.*\//, ''));
    expect(names).toContain('f01-testsrc2-1080p30-10s.mp4');
    expect(names).not.toContain('manifest.json');
  });
});

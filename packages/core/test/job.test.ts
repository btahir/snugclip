// G1, G2, G5 (unit): job files and deep links.
import { describe, expect, it } from 'vitest';
import { JOB_SCHEMA_URL, createJob, jobFromQuery, jobFromQueryWithNotices, jobOptions, jobTarget, jobToQuery, jsonSchemas, parseJob, parseJobWithWarnings, queryToRecord, serializeJob, type Job } from '../src/index.js';

const samples: Job[] = [
  { $schema: JOB_SCHEMA_URL, snugclip: 'job', version: 1, target: { preset: 'discord' } },
  { snugclip: 'job', version: 1, target: { bytes: 10_000_000 } },
  { snugclip: 'job', version: 1, target: { size: '9.5MiB' } },
  { snugclip: 'job', version: 1, target: { preset: 'whatsapp' }, options: { trim: { startSec: 1.5, endSec: 9.25 } } },
  { snugclip: 'job', version: 1, target: { preset: 'gmail' }, options: { codec: 'smaller', maxShortSide: 720, fpsCap: 24, keepFps: false, mute: true, reencode: true } },
  { snugclip: 'job', version: 1, target: { size: '25MB' }, options: { codec: 'vp9', keepFps: true } },
  { snugclip: 'job', version: 1, target: { preset: 'size-8' }, inputs: ['clips/a.mov', 'clips/*.mp4'] },
  { snugclip: 'job', version: 1, target: { bytes: 20_000_000 }, output: { dir: 'out/', pattern: '{name}-snug-{size}.{ext}' } },
  { snugclip: 'job', version: 1, target: { preset: 'outlook' }, options: { fpsCap: null as unknown as number }, reports: [{ snugclip: 'report' } as never] },
  { snugclip: 'job', version: 1, target: { preset: 'slack' }, futureField: { x: 1 } },
];

describe('job file v1', () => {
  it.each(samples.map((s, i) => [i, s] as const))('#%d round-trips: serializeJob(parseJob(x)) == canonical x', (_i, x) => {
    const text = serializeJob(x);
    expect(JSON.parse(serializeJob(parseJob(text)))).toEqual(JSON.parse(text));
    expect(JSON.parse(text)).toEqual(x);
  });
  it('unknown top-level keys are preserved with a warning', () => {
    const { job, warnings } = parseJobWithWarnings(JSON.stringify(samples[9]));
    expect(warnings).toEqual(['Unknown field "futureField" kept as is.']);
    expect(serializeJob(job)).toContain('"futureField"');
  });
  it('version and content errors', () => {
    const base = { snugclip: 'job', target: { preset: 'discord' } };
    expect(() => parseJob({ ...base, version: 2 })).toThrow(expect.objectContaining({ code: 'E_JOB_VERSION', message: 'This job file is version 2; this Snugclip reads version 1.' }));
    expect(() => parseJob(base)).toThrow(expect.objectContaining({ code: 'E_JOB' }));
    expect(() => parseJob({ ...base, version: 1, target: { preset: 'myspace' } })).toThrow(expect.objectContaining({ code: 'E_PRESET' }));
    expect(() => parseJob({ ...base, version: 1, options: { trim: { startSec: 5, endSec: 5 } } })).toThrow(expect.objectContaining({ code: 'E_TRIM' }));
    expect(() => parseJob({ ...base, version: 1, target: { preset: 'discord', bytes: 5 } })).toThrow(expect.objectContaining({ code: 'E_JOB' }));
    expect(() => parseJob('{nope')).toThrow(expect.objectContaining({ code: 'E_JOB' }));
    expect(() => parseJob({ ...base, version: 1, options: { bogus: true } })).toThrow(expect.objectContaining({ code: 'E_JOB' }));
  });
  it('resolves targets and options', () => {
    expect(jobTarget(samples[2]!)).toEqual({ bytes: 9_961_472, label: '9.96 MB' });
    expect(jobOptions(samples[8]!)).toEqual({ codec: 'compatible', keepFps: false, mute: false, reencode: false });
    const j = createJob({ bytes: 20_000_000, presetId: 'discord', label: 'Discord' }, { codec: 'h264', maxShortSide: 720, mute: true });
    expect(j).toEqual({ $schema: JOB_SCHEMA_URL, snugclip: 'job', version: 1, target: { preset: 'discord' }, options: { codec: 'h264', maxShortSide: 720, mute: true } });
  });
  it('publishes a JSON Schema', () => {
    const s = jsonSchemas().job as { properties: Record<string, unknown> };
    expect(Object.keys(s.properties)).toEqual(expect.arrayContaining(['snugclip', 'version', 'target', 'options', 'inputs', 'output', 'reports']));
  });
});

describe('deep links', () => {
  it('parses the brief example', () => {
    expect(jobFromQuery(queryToRecord('/?preset=discord&codec=h264&maxh=720&mute=1&start=1&end=3'))).toEqual({
      target: { preset: 'discord' },
      options: { codec: 'h264', maxShortSide: 720, mute: true, trim: { startSec: 1, endSec: 3 } },
    });
  });
  it('size overrides preset; invalid params are ignored with a notice', () => {
    const r = jobFromQueryWithNotices({ preset: 'discord', size: '9.5MB', maxh: 'abc', codec: 'mpeg2', fps: '30', keepfps: '1', utm_source: 'x' });
    expect(r.job).toEqual({ target: { size: '9.5MB' }, options: { fpsCap: 30, keepFps: true } });
    expect(r.notices).toHaveLength(2);
  });
  it.each(['preset=discord&codec=h264&maxh=720', 'size=9.5MB&codec=smaller&fps=24&keepfps=1&mute=1&start=1.5&end=9.25&reencode=1', 'preset=whatsapp&start=2', 'size=10MiB&end=12', ''])(
    'jobToQuery(jobFromQuery(q)) round-trips %j',
    (q) => {
      expect(jobToQuery(jobFromQuery(queryToRecord(`?${q}`)))).toBe(q);
    },
  );
  it('never carries file names', () => {
    expect(jobToQuery({ ...samples[6]!, target: { preset: 'size-8' } })).toBe('preset=size-8');
  });
});

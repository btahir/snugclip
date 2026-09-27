import { describe, expect, it } from 'vitest';
import { MB, calibrationWindows, compress, secantStep, type FitProgress } from '../src/index.js';
import { FakeClock, FakeEngine, makeProbe, type FakeBehaviour } from './fake-engine.js';

async function run(behaviour: FakeBehaviour, opts: { target?: number; probe?: ReturnType<typeof makeProbe>; calibration?: 'auto' | 'on' | 'off'; signal?: AbortSignal } = {}) {
  const clock = new FakeClock();
  const probe = opts.probe ?? makeProbe();
  const engine = new FakeEngine(probe, behaviour, clock);
  const progress: FitProgress[] = [];
  const result = await compress({
    engine,
    input: 'in.mp4',
    target: { bytes: opts.target ?? 10 * MB },
    clock: clock.now,
    onProgress: (p) => progress.push(p),
    ...(opts.calibration ? { calibration: opts.calibration } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return { ...result, engine, progress, clock };
}

function assertNeverKeptOver(r: Awaited<ReturnType<typeof run>>) {
  const target = r.report.target.bytes;
  for (const a of r.report.attempts) if (a.kept) expect(a.bytes).toBeLessThanOrEqual(target);
  if (r.output) expect(r.output.bytes).toBeLessThanOrEqual(target);
  // Every output the loop didn't return was discarded (no leaked temp files).
  const live = [...r.engine.live];
  expect(live).toEqual(r.output ? [r.output.id] : []);
}

describe('fit loop (fake engine)', () => {
  it('accurate encoder: one attempt, fits between acceptFill and target', async () => {
    const r = await run({ ratio: 1 });
    expect(r.report.verdict).toBe('fits');
    expect(r.report.attempts.filter((a) => a.kind === 'encode')).toHaveLength(1);
    expect(r.output!.bytes).toBeLessThanOrEqual(10 * MB);
    expect(r.output!.bytes).toBeGreaterThanOrEqual(0.9 * 10 * MB);
    expect(r.report.quality?.label).toBe('Looks great');
    assertNeverKeptOver(r);
  });

  it('overshooting encoder: first output discarded, corrected under target', async () => {
    const r = await run({ ratio: 1.15 });
    const encodes = r.report.attempts.filter((a) => a.kind === 'encode');
    expect(encodes[0]!.fits).toBe(false);
    expect(encodes[0]!.kept).toBe(false);
    expect(r.report.verdict).toBe('fits');
    expect(encodes.length).toBe(2);
    assertNeverKeptOver(r);
  });

  it('undershooting encoder (static content): climbs back toward the target', async () => {
    const r = await run({ ratio: 0.55 });
    const encodes = r.report.attempts.filter((a) => a.kind === 'encode');
    expect(encodes.length).toBeGreaterThanOrEqual(2);
    expect(encodes[0]!.fits).toBe(true);
    expect(r.output!.bytes).toBeGreaterThanOrEqual(0.9 * 10 * MB);
    assertNeverKeptOver(r);
  });

  it('drifting encoder: first attempt 25% heavy, later ones accurate', async () => {
    const r = await run({ ratio: 1, drift: { 1: 1.25 } });
    expect(r.report.verdict).toBe('fits');
    assertNeverKeptOver(r);
  });

  it('encoder floor: drops a rung when asking for fewer bits stops working', async () => {
    // Floor at 0.12 bpp: at 480p30 the planner's ~0.094 bpp request can't be honoured.
    const r = await run({ floorBpp: 0.12 });
    expect(r.report.verdict).toBe('fits');
    const encodes = r.report.attempts.filter((a) => a.kind === 'encode');
    const first = encodes[0]!;
    const last = encodes.find((a) => a.kept)!;
    expect(last.width * last.height).toBeLessThan(first.width * first.height);
    expect(r.report.warnings.join(' ')).toMatch(/dropped to/i);
    assertNeverKeptOver(r);
  });

  it('hopeless encoder: fails with no output and discards everything', async () => {
    const r = await run({ ratio: 3, floorBpp: 5 });
    expect(r.report.verdict).toBe('failed');
    expect(r.report.error?.code).toBe('COULD_NOT_FIT');
    expect(r.output).toBeNull();
    expect(r.report.attempts.every((a) => !a.kept)).toBe(true);
    assertNeverKeptOver(r);
  });

  it('one-pass engine calibrates with samples first and uses the measured ratio', async () => {
    const r = await run({ ratio: 1.3, rateControl: 'one-pass' });
    const samples = r.report.attempts.filter((a) => a.kind === 'sample');
    expect(samples.length).toBe(3);
    expect(r.report.calibration?.ratio).toBeCloseTo(1.3, 2);
    expect(r.engine.calls.filter((c) => c.sample).every((c) => c.audio === null)).toBe(true);
    // Calibration means the first full encode already fits.
    expect(r.report.attempts.filter((a) => a.kind === 'encode')).toHaveLength(1);
    expect(r.report.verdict).toBe('fits');
    assertNeverKeptOver(r);
  });

  it('two-pass engine skips calibration by default; calibration "on" forces it', async () => {
    expect((await run({})).report.calibration).toBeNull();
    expect((await run({}, { calibration: 'on' })).report.calibration?.samples).toBe(3);
  });

  it('passthrough returns no output and verdict passthrough', async () => {
    const r = await run({}, { probe: makeProbe({ sizeBytes: 3 * MB }) });
    expect(r.report.verdict).toBe('passthrough');
    expect(r.report.fits).toBe(true);
    expect(r.output).toBeNull();
    expect(r.engine.calls).toHaveLength(0);
    expect(r.report.output?.bytes).toBe(3 * MB);
  });

  it('impossible target: refuses before encoding with the minimum size', async () => {
    const r = await run({}, { probe: makeProbe({ durationSec: 1800 }), target: 8 * MB });
    expect(r.report.verdict).toBe('impossible');
    expect(r.report.error?.code).toBe('IMPOSSIBLE_TARGET');
    expect(r.report.minimumBytes).toBeGreaterThan(8 * MB);
    expect(r.engine.calls).toHaveLength(0);
  });

  it('cancel mid-encode: verdict cancelled, nothing leaked', async () => {
    const controller = new AbortController();
    const r = await run({ ratio: 1.15, abortOn: { call: 2, controller } }, { signal: controller.signal });
    expect(r.report.verdict).toBe('cancelled');
    expect(r.output).toBeNull();
    expect([...r.engine.live]).toEqual([]);
  });

  it('cancel after a fitting-but-small attempt discards the kept output too', async () => {
    const controller = new AbortController();
    const r = await run({ ratio: 0.5, abortOn: { call: 2, controller } }, { signal: controller.signal });
    expect(r.report.verdict).toBe('cancelled');
    expect([...r.engine.live]).toEqual([]);
  });

  it('engine errors become a failed report', async () => {
    const r = await run({ failOn: { call: 1, error: new Error('encoder exploded') } });
    expect(r.report.verdict).toBe('failed');
    expect(r.report.error).toEqual({ code: 'ENCODE_FAILED', message: 'encoder exploded' });
  });

  it('progress is monotonic, ends at 1, and elapsed uses the injected clock', async () => {
    const r = await run({ ratio: 1.15 });
    const overall = r.progress.map((p) => p.overall);
    for (let i = 1; i < overall.length; i++) expect(overall[i]!).toBeGreaterThanOrEqual(overall[i - 1]!);
    expect(overall.at(-1)).toBe(1);
    expect(r.progress.at(-1)!.etaMs).toBe(0);
    // 2 encodes × 60 s × 100 ms/s on the fake clock.
    expect(r.report.elapsedMs).toBe(12_000);
  });

  it('golden: attempt log for an overshooting one-pass encoder', async () => {
    const r = await run({ ratio: 1.2, drift: { 1: 1.1, 2: 0.97 }, rateControl: 'one-pass' });
    const log = r.report.attempts.map((a) => `${a.kind}#${a.n} ${a.width}x${a.height}@${a.fps} req=${a.requestedVideoBitrate} bytes=${a.bytes} fits=${a.fits} kept=${a.kept}`);
    expect(log).toMatchInlineSnapshot(`
      [
        "sample#1 854x480@30 req=1158636 bytes=421925 fits=true kept=false",
        "sample#2 854x480@30 req=1158636 bytes=421925 fits=true kept=false",
        "sample#3 854x480@30 req=1158636 bytes=421935 fits=true kept=false",
        "encode#1 854x480@30 req=965529 bytes=10568963 fits=false kept=false",
        "encode#2 854x480@30 req=847451 bytes=8408473 fits=true kept=false",
        "encode#3 854x480@30 req=903490 bytes=9141636 fits=true kept=true",
      ]
    `);
  });
});

describe('helpers', () => {
  it('calibrationWindows: 3 windows for long clips, inside the range', () => {
    expect(calibrationWindows(0, 60)).toEqual([
      { start: 13.8, end: 16.2 },
      { start: 28.8, end: 31.2 },
      { start: 43.8, end: 46.2 },
    ]);
    const w = calibrationWindows(5, 12);
    expect(w).toHaveLength(2);
    for (const x of w) {
      expect(x.start).toBeGreaterThanOrEqual(5);
      expect(x.end).toBeLessThanOrEqual(17);
    }
  });
  it('secantStep: proportional with one point, uses slope with two', () => {
    expect(secantStep([{ req: 1000_000, act: 1100_000 }], 1000_000).next).toBe(909_090);
    const s = secantStep(
      [
        { req: 1000_000, act: 1200_000 },
        { req: 800_000, act: 1100_000 },
      ],
      1000_000,
    );
    expect(s.slope).toBeCloseTo(0.39, 2);
    expect(s.next).toBeLessThan(800_000);
  });
});

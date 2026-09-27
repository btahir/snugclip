// A5: fit-loop state machine driven through runFit with scripted fake engines.
import { describe, expect, it } from 'vitest';
import { MB, applyResult, initFitState, isNativeAacSafe, nextStep, plan, runFit, type FitProgress, type Report } from '../src/index.js';
import { FakeEngine, makeProbe, testCaps, webCaps, type RateModel } from './fake-engine.js';

const nodeTimers = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };

async function run(model: RateModel, o: { probe?: ReturnType<typeof makeProbe>; target?: number; caps?: ReturnType<typeof testCaps>; signal?: AbortSignal; stallMs?: number; options?: Record<string, unknown> } = {}) {
  const probe = o.probe ?? makeProbe();
  const engine = new FakeEngine(probe, model, o.caps ?? testCaps());
  let t = 1_000_000;
  const progress: FitProgress[] = [];
  const report = await runFit(engine, 'in.mp4', { bytes: o.target ?? 10 * MB, label: '10 MB' }, o.options ?? {}, {
    now: () => (t += 50),
    signal: o.signal ?? new AbortController().signal,
    onProgress: (p) => progress.push(p),
    inputName: 'in.mp4',
    ...(o.stallMs ? { stallMs: o.stallMs, timers: nodeTimers } : {}),
  });
  return { report, engine, progress };
}

function invariants(r: { report: Report; engine: FakeEngine }) {
  const T = r.report.target.bytes;
  for (const c of r.engine.committed) expect(c.bytes).toBeLessThanOrEqual(T);
  expect(r.engine.committed.length).toBeLessThanOrEqual(1);
  // Nothing leaks: every encoded output was committed or discarded.
  expect([...r.engine.live].filter((id) => !r.engine.committed.some((c) => c.id === id))).toEqual([]);
  if (r.report.status === 'fit') {
    expect(r.report.output!.bytes).toBeLessThanOrEqual(T);
    expect(r.engine.committed).toHaveLength(1);
  } else expect(r.engine.committed).toHaveLength(0);
}

const full = (r: Report) => r.attempts.filter((a) => a.purpose !== 'calibration');

describe('fit loop', () => {
  it('(a) accurate encoder fits on attempt 1', async () => {
    const r = await run({ ratio: 1 });
    expect(r.report.status).toBe('fit');
    expect(full(r.report)).toHaveLength(1);
    expect(r.report.output!.bytes).toBeGreaterThanOrEqual(0.9 * 10 * MB);
    expect(r.report.quality).toMatchObject({ verdict: 'great', label: 'Looks great', frames: 10 });
    expect(r.report.engine).toEqual({ id: 'ffmpeg', version: 'test', encoder: 'fake264' });
    invariants(r);
  });
  it('(b) +15% overshoot: fits by attempt ≤ 3 and never commits over-target', async () => {
    const r = await run({ ratio: 1.15 });
    expect(r.report.status).toBe('fit');
    expect(full(r.report)[0]!.fits).toBe(false);
    expect(full(r.report).length).toBeLessThanOrEqual(3);
    invariants(r);
  });
  it('(c) −30% undershoot: raises the bitrate and ends ≥ 0.90·T', async () => {
    const r = await run({ ratio: 0.7 });
    expect(r.report.status).toBe('fit');
    expect(full(r.report).length).toBeGreaterThanOrEqual(2);
    expect(r.report.output!.bytes).toBeGreaterThanOrEqual(0.9 * 10 * MB);
    invariants(r);
  });
  it('(d) encoder floor: drops a rung', async () => {
    // Floor at 0.10 bpp: the 480p rung can't reach the budget, 360p can.
    const r = await run({ floorBpp: 0.1 });
    expect(r.report.status).toBe('fit');
    const f = full(r.report);
    const kept = f.find((a) => a.bytes === r.report.output!.bytes)!;
    expect(kept.rung.width * kept.rung.height).toBeLessThan(f[0]!.rung.width * f[0]!.rung.height);
    expect(r.report.warnings.map((w) => w.code)).toContain('encoder-floor');
    invariants(r);
  });
  it('(d) floor at the lowest rung returns impossible with measured minimumBytes', async () => {
    // 1 h clip at a target just above the planned minimum, with a floor far above the planner's.
    const probe = makeProbe({ durationSec: 3600 });
    const min = plan(probe, { bytes: 1 * MB, label: 'x' }, {}, testCaps()).minimumBytes;
    const r = await run({ floorBpp: 0.3 }, { probe, target: Math.ceil(min * 1.02), options: { maxAttempts: 8 } });
    expect(r.report.status).toBe('impossible');
    expect(r.report.error?.code).toBe('E_IMPOSSIBLE');
    expect(r.report.minimumSource).toBe('measured');
    const minObserved = Math.min(...full(r.report).map((a) => a.bytes));
    expect(r.report.minimumBytes).toBe(Math.ceil(minObserved * 1.05));
    invariants(r);
  });
  it('(e) always-overshoot: rescue attempt, then E_FIT_FAILED, no commit', async () => {
    const r = await run({ ratio: 1.6, drift: { 1: 1, 2: 3, 3: 9, 4: 27 } });
    expect(r.report.status).toBe('error');
    expect(r.report.error?.code).toBe('E_FIT_FAILED');
    expect(r.report.attempts.at(-1)!.purpose).toBe('rescue');
    expect(full(r.report)).toHaveLength(4);
    invariants(r);
  });
  it('(f) stall: one realtime retry, then E_STALL', async () => {
    const r = await run({ stallOn: [1, 2] }, { stallMs: 30 });
    expect(r.report.status).toBe('error');
    expect(r.report.error?.code).toBe('E_STALL');
    expect(r.engine.calls[1]!.video.latency).toBe('realtime');
    expect(r.engine.calls[0]!.video.latency).toBe('quality');
    invariants(r);
  });
  it('(f) a single stall recovers in realtime mode', async () => {
    const r = await run({ stallOn: [1] }, { stallMs: 30 });
    expect(r.report.status).toBe('fit');
    expect(r.report.warnings.map((w) => w.code)).toContain('stall-retry');
    invariants(r);
  });
  it('(g) abort mid-attempt: cancelled, discard() called, no commit', async () => {
    const controller = new AbortController();
    const r = await run({ ratio: 1.15, abortOn: { call: 2, controller } }, { signal: controller.signal });
    expect(r.report.status).toBe('cancelled');
    expect(r.engine.discarded.length).toBeGreaterThanOrEqual(1);
    invariants(r);
  });
  it('(g) abort after a kept-but-small attempt discards it', async () => {
    const controller = new AbortController();
    const r = await run({ ratio: 0.5, abortOn: { call: 2, controller } }, { signal: controller.signal });
    expect(r.report.status).toBe('cancelled');
    expect(r.engine.discarded).toContain(1);
    invariants(r);
  });
  it('simple content (screen recording): jumps up to a sharper rung, then stops asking for bits', async () => {
    const r = await run({ contentBpp: 0.005, splitBytes: true });
    expect(r.report.status).toBe('fit');
    const f = full(r.report);
    expect(f[0]!.rung.width).toBe(854);
    expect(f.at(-1)!.rung).toMatchObject({ width: 1920, height: 1080 });
    expect(f.length).toBe(2);
    expect(r.report.warnings.map((w) => w.code)).toContain('simple-content');
    expect(r.report.output!.video).toMatchObject({ width: 1920, height: 1080 });
    invariants(r);
  });
  it('static content: keeps the sharper rung even when it is not bigger in bytes', async () => {
    const r = await run({ contentCapBps: 100_000, splitBytes: true });
    expect(r.report.status).toBe('fit');
    expect(r.report.output!.video).toMatchObject({ width: 1920, height: 1080 });
    invariants(r);
  });
  it('calibrates one-pass engines (median ratio) and reports complexity', async () => {
    const r = await run({ ratio: 1.3 }, { caps: webCaps() });
    const cal = r.report.attempts.filter((a) => a.purpose === 'calibration');
    expect(cal).toHaveLength(3);
    expect(r.engine.calls.filter((c) => c.purpose === 'calibration').every((c) => c.audio.mode === 'none' && c.trim)).toBe(true);
    expect(r.report.complexity).toBe('low');
    expect(full(r.report)).toHaveLength(1);
    expect(r.report.status).toBe('fit');
    invariants(r);
  });
  it('skips calibration for two-pass codecs and for clips under 15 s', async () => {
    expect((await run({})).report.attempts.every((a) => a.purpose !== 'calibration')).toBe(true);
    const short = await run({}, { caps: webCaps(), probe: makeProbe({ durationSec: 10 }) });
    expect(short.report.attempts.every((a) => a.purpose !== 'calibration')).toBe(true);
  });
  it('pass-through and impossible never encode', async () => {
    const pt = await run({}, { probe: makeProbe({ sizeBytes: 3 * MB }) });
    expect(pt.report).toMatchObject({ status: 'passthrough', fits: true, passThrough: true, attempts: [], quality: null });
    expect(pt.engine.passed).toBe(1);
    expect(pt.engine.calls).toHaveLength(0);
    const imp = await run({}, { probe: makeProbe({ durationSec: 3600 }), target: 2 * MB });
    expect(imp.report).toMatchObject({ status: 'impossible', minimumSource: 'planned', error: { code: 'E_IMPOSSIBLE' } });
    expect(imp.engine.calls).toHaveLength(0);
  });
  it('unsupported input and engine errors become reports', async () => {
    const noVideo = await run({}, { probe: { ...makeProbe(), video: null } });
    expect(noVideo.report).toMatchObject({ status: 'unsupported', error: { code: 'E_UNSUPPORTED' } });
    const boom = await run({ failOn: { call: 1, error: new Error('encoder exploded') } });
    expect(boom.report).toMatchObject({ status: 'error', error: { code: 'E_ENCODE', message: 'encoder exploded' } });
  });
  it('progress is monotonic and ends at 1 with eta 0', async () => {
    const r = await run({ ratio: 1.15 }, { caps: webCaps() });
    const o = r.progress.map((p) => p.overall);
    for (let i = 1; i < o.length; i++) expect(o[i]!).toBeGreaterThanOrEqual(o[i - 1]!);
    expect(r.progress.at(-1)).toMatchObject({ phase: 'done', overall: 1, etaMs: 0 });
    expect(r.progress.some((p) => p.phase === 'calibrating')).toBe(true);
    expect(r.progress.some((p) => p.phase === 'checking')).toBe(true);
  });
  it('createdAt comes from the injected clock', async () => {
    const r = await run({});
    expect(r.report.createdAt).toBe(new Date(1_000_050).toISOString());
  });
  it('commit() is never called with bytes > T across 1,000 seeded random models', async () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const statuses: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const model: RateModel = {
        ratio: 0.4 + rnd() * 2.2,
        floorBpp: rnd() < 0.3 ? rnd() * 0.3 : 0,
        drift: { 1: 0.8 + rnd() * 0.6, 2: 0.8 + rnd() * 0.6, 3: 0.8 + rnd() * 0.6, 4: 0.8 + rnd() * 0.6 },
        splitBytes: rnd() < 0.5,
      };
      const probe = makeProbe({ durationSec: 5 + rnd() * 600, fps: rnd() < 0.3 ? 60 : 30, width: rnd() < 0.5 ? 1920 : 1280, height: rnd() < 0.5 ? 1080 : 720 });
      const pick = rnd();
      const caps = pick < 0.33 ? testCaps() : pick < 0.66 ? webCaps() : webCaps({ canEncodeAudio: (c, b, ch, sr) => c !== 'aac' || isNativeAacSafe(b, ch, sr) });
      const r = await run(model, { probe, target: Math.round((1 + rnd() * 60) * MB), caps });
      invariants(r);
      if (pick >= 0.66 && r.report.plan?.audio.mode === 'encode') {
        const a = r.report.plan.audio;
        expect(isNativeAacSafe(a.bitrate!, a.channels!, a.sampleRate!)).toBe(true);
      }
      statuses[r.report.status] = (statuses[r.report.status] ?? 0) + 1;
    }
    expect(statuses.fit).toBeGreaterThan(500);
  }, 60_000);
});

describe('state machine is pure', () => {
  it('nextStep/applyResult never mutate their input', () => {
    const probe = makeProbe();
    const caps = testCaps();
    const p = plan(probe, { bytes: 10 * MB, label: 'x' }, {}, caps);
    const s0 = initFitState(probe, { bytes: 10 * MB, label: 'x' }, {}, p, caps);
    const snap = JSON.stringify(s0);
    const step = nextStep(s0);
    expect(step.kind).toBe('encode');
    const s1 = applyResult(s0, step, { bytes: 11 * MB, elapsedMs: 1 });
    expect(JSON.stringify(s0)).toBe(snap);
    expect(s1.attempts).toHaveLength(1);
    expect(s1.margin).toBeCloseTo(0.04);
    const step2 = nextStep(s1);
    expect(step2.kind === 'encode' && step2.plan.video.bitrate).toBeLessThan(step.kind === 'encode' ? step.plan.video.bitrate : 0);
  });
});

// The fit loop (PLAN §4.7–4.8) as a pure state machine (`nextStep` / `applyResult`) plus the
// async orchestrator `runFit` that drives an Engine with it.
//
// Guarantee: `engine.commit()` is only ever called for an output whose bytes ≤ target. Outputs
// that overshoot are discarded immediately; if nothing fits, nothing is committed.
import { SnugclipError, isAbortError, isSnugclipError, type ErrorCode } from './errors.js';
import { bppThresholds, normalizeOptions, overheadBytes, plan as makePlan } from './plan.js';
import { complexityFrom, evalShortSide, quality, qualityTimes, ssimPair, verdict } from './quality.js';
import { MIME, outputName } from './size.js';
import { TUNING } from './tuning.js';
import type {
  AbortSignalLike,
  Attempt,
  EncodePlan,
  EncodeResult,
  Engine,
  EngineCapabilities,
  FitProgress,
  LumaFrame,
  Options,
  Plan,
  Probe,
  Report,
  Rung,
  Target,
  Timers,
  TrimRange,
  VideoCodecId,
  Warning,
} from './types.js';

export interface FitState {
  probe: Probe;
  target: Target;
  options: Options;
  plan: Plan;
  phase: 'calibrate' | 'fit' | 'done' | 'failed';
  maxAttempts: number;
  /** Source-time calibration windows (empty when calibration is skipped). */
  calWindows: TrimRange[];
  calSamples: { rungIndex: number; ratio: number; ssim?: number }[];
  rungProbe: 'none' | 'pending' | 'done';
  ratio: number;
  complexity?: 'low' | 'medium' | 'high';
  rungIndex: number;
  nextBitrate: number;
  margin: number;
  /** (requested video bitrate, measured video bytes) at the current rung. */
  history: { req: number; bv: number }[];
  fullAttempts: number;
  rescue: 'none' | 'pending' | 'done';
  best: { index: number; bytes: number; pixRate: number } | null;
  capped: boolean;
  /** Bytes that aren't video (container + audio); measured when the engine splits them. */
  nonVideoBytes: number;
  latency: 'quality' | 'realtime';
  stallRetried: boolean;
  attempts: Attempt[];
  minObservedBytes: number | null;
  failure?: { code: ErrorCode; message: string };
  measuredMinimumBytes?: number;
  warnings: Warning[];
}

export type FitStep =
  | { kind: 'encode'; plan: EncodePlan<unknown>; rung: Rung; sample?: 'main' | 'rung-probe' }
  | { kind: 'done' }
  | { kind: 'fail'; code: ErrorCode; message: string };

export type FitOutcome = { bytes: number; videoBytes?: number; elapsedMs: number; ssim?: number } | { stalled: true; elapsedMs: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
};

function audioSpec(s: FitState) {
  const a = s.plan.audio;
  return a.mode === 'none' ? null : { codec: a.codec!, sampleRate: a.sampleRate! };
}

function estimateNonVideo(s: FitState, fps: number): number {
  return overheadBytes(s.plan.container, s.plan.durationSec, fps, audioSpec(s)) + s.plan.audio.bytes;
}

/** Quality ceiling and source-bitrate cap for a rung (PLAN §4.4). */
function ceilingFor(s: FitState, r: Rung): number {
  const v = s.probe.video!;
  const ceil = bppThresholds(s.plan.video!.codec).ceiling * r.width * r.height * r.fps;
  const src = v.bitrate ?? (s.probe.sizeBytes * 8) / s.probe.durationSec - (s.probe.audio?.bitrate ?? 0);
  return Math.min(ceil, src > 0 ? src * TUNING.sourceBitrateFactor : Infinity);
}

/** Video bitrate that fills T·(1 − margin) at a rung (before the ceiling). */
function vbrFor(s: FitState, rungIndex: number, margin: number): number {
  const r = s.plan.rungs[rungIndex]!;
  const S = Math.floor(s.target.bytes * (1 - margin));
  return Math.max(1000, ((S - estimateNonVideo(s, r.fps)) * 8) / s.plan.durationSec);
}

function floorBps(s: FitState, r: Rung): number {
  return bppThresholds(s.plan.video!.codec).floor * r.width * r.height * r.fps;
}

/** Calibration windows: n = D ≥ 30 ? 3 : 2; len = clamp(0.04·D, 2, 4) s, ≥ 2 keyframe intervals, ≤ D/n. */
export function calibrationWindows(startSec: number, durationSec: number, keyframeIntervalSec: number): TrimRange[] {
  const n = durationSec >= 30 ? 3 : 2;
  const c = TUNING.calibration.len;
  let len = Math.max(clamp(c.fraction * durationSec, c.min, c.max), 2 * keyframeIntervalSec);
  len = Math.min(len, durationSec / n);
  const out: TrimRange[] = [];
  for (let i = 0; i < n; i++) {
    const centre = startSec + (durationSec * (i + 1)) / (n + 1);
    const s = clamp(centre - len / 2, startSec, startSec + durationSec - len);
    out.push({ startSec: Math.round(s * 1000) / 1000, endSec: Math.round((s + len) * 1000) / 1000 });
  }
  return out;
}

export function shouldCalibrate(caps: EngineCapabilities, codec: VideoCodecId, durationSec: number): boolean {
  if (durationSec < TUNING.calibration.minDuration) return false;
  if (caps.rateCalibration === 'always') return true;
  if (caps.rateCalibration === 'never') return false;
  return !(caps.twoPassCodecs ?? (caps.twoPass ? ['h264'] : [])).includes(codec);
}

/** Initial state for a feasible, non-pass-through plan. */
export function initFitState(probe: Probe, target: Target, options: Partial<Options>, plan: Plan, caps: EngineCapabilities): FitState {
  if (!plan.video || !plan.feasible || plan.passThrough) throw new SnugclipError('E_INTERNAL', 'initFitState needs a feasible encode plan');
  const opts = normalizeOptions(options);
  const codec = plan.video.codec;
  const twoPass = (caps.twoPassCodecs ?? (caps.twoPass ? ['h264'] : [])).includes(codec);
  const cal = shouldCalibrate(caps, codec, plan.durationSec);
  const s: FitState = {
    probe,
    target,
    options: opts,
    plan,
    phase: cal ? 'calibrate' : 'fit',
    maxAttempts: opts.maxAttempts ?? (twoPass ? TUNING.maxAttempts.twoPass : TUNING.maxAttempts.onePass),
    calWindows: cal ? calibrationWindows(plan.trim?.startSec ?? 0, plan.durationSec, plan.video.keyframeIntervalSec) : [],
    calSamples: [],
    rungProbe: 'none',
    ratio: 1,
    rungIndex: plan.video.rungIndex,
    nextBitrate: plan.video.bitrate,
    margin: plan.marginBytes / plan.targetBytes,
    history: [],
    fullAttempts: 0,
    rescue: 'none',
    best: null,
    capped: !!plan.video.capped,
    nonVideoBytes: 0,
    latency: 'quality',
    stallRetried: false,
    attempts: [],
    minObservedBytes: null,
    warnings: [],
  };
  s.nonVideoBytes = estimateNonVideo(s, plan.video.fps);
  return s;
}

function encodePlanFor(s: FitState, rung: Rung, bitrate: number, purpose: EncodePlan<unknown>['purpose'], trim?: TrimRange): EncodePlan<unknown> {
  const codec = s.plan.video!.codec;
  const b = Math.max(1000, Math.floor(bitrate));
  const tierA = b / (rung.width * rung.height * rung.fps) / TUNING.k[codec] >= TUNING.bppGood - 1e-9;
  const p: EncodePlan<unknown> = {
    input: undefined,
    purpose,
    container: s.plan.container,
    video: { codec, width: rung.width, height: rung.height, fps: rung.fps, bitrate: b, keyframeIntervalSec: TUNING.keyframeSec[tierA ? 'A' : 'B'], latency: s.latency },
    audio: purpose === 'calibration' ? { mode: 'none', bytes: 0 } : s.plan.audio,
    hdrToSdr: !!s.probe.video?.hdr,
  };
  const t = trim ?? s.plan.trim;
  if (t) p.trim = t;
  return p;
}

/** The next thing to do. Pure. */
export function nextStep(s: FitState): FitStep {
  if (s.phase === 'done') return { kind: 'done' };
  if (s.phase === 'failed') return { kind: 'fail', code: s.failure!.code, message: s.failure!.message };
  if (s.phase === 'calibrate') {
    const i = s.calSamples.length;
    if (i < s.calWindows.length) {
      const rung = s.plan.rungs[s.rungIndex]!;
      return { kind: 'encode', plan: encodePlanFor(s, rung, s.plan.video!.bitrate, 'calibration', s.calWindows[i]), rung, sample: 'main' };
    }
    const rung = s.plan.rungs[s.rungIndex + 1]!;
    const mid = s.calWindows[Math.floor(s.calWindows.length / 2)]!;
    const b = Math.min(vbrFor(s, s.rungIndex + 1, s.margin), ceilingFor(s, rung));
    return { kind: 'encode', plan: encodePlanFor(s, rung, b, 'calibration', mid), rung, sample: 'rung-probe' };
  }
  const rung = s.plan.rungs[s.rungIndex]!;
  return { kind: 'encode', plan: encodePlanFor(s, rung, s.nextBitrate, s.rescue === 'pending' ? 'rescue' : 'full'), rung };
}

function startFit(s: FitState): FitState {
  s.phase = 'fit';
  const rung = s.plan.rungs[s.rungIndex]!;
  const vbr0 = Math.min(vbrFor(s, s.rungIndex, s.margin), ceilingFor(s, rung));
  const [lo, hi] = TUNING.calibration.vbr1Clamp;
  let vbr1 = clamp(vbr0 / s.ratio, lo * vbr0, hi * vbr0);
  if (s.ratio >= 0.9 && vbr1 > vbr0) vbr1 = vbr0; // only go up when the encoder clearly undershoots
  s.nextBitrate = Math.floor(Math.min(vbr1, ceilingFor(s, rung)));
  return s;
}

/** Folds an encode outcome into the state. Pure: returns a new state. */
export function applyResult(state: FitState, step: FitStep, outcome: FitOutcome): FitState {
  if (step.kind !== 'encode') return state;
  const s: FitState = { ...state, calSamples: [...state.calSamples], history: [...state.history], attempts: [...state.attempts], warnings: [...state.warnings] };
  const T = s.target.bytes;
  const D = s.plan.durationSec;
  const p = step.plan;

  if ('stalled' in outcome) {
    if (!s.stallRetried) {
      s.stallRetried = true;
      s.latency = 'realtime';
      s.warnings.push({ code: 'stall-retry', message: 'The encoder stalled; retrying in low-latency mode.' });
      return s;
    }
    s.phase = 'failed';
    s.failure = { code: 'E_STALL', message: 'The encoder stalled twice and was stopped. Try again or use another browser.' };
    return s;
  }

  if (p.purpose === 'calibration') {
    const len = p.trim!.endSec - p.trim!.startSec;
    const vb = outcome.videoBytes ?? Math.max(1, outcome.bytes - overheadBytes(p.container, len, p.video.fps, null));
    const ratio = vb / ((p.video.bitrate * len) / 8);
    s.attempts.push({
      index: s.attempts.length,
      purpose: 'calibration',
      rung: step.rung,
      requestedVideoBitrate: p.video.bitrate,
      bytes: outcome.bytes,
      ...(outcome.videoBytes !== undefined ? { videoBytes: outcome.videoBytes } : {}),
      fits: true,
      elapsedMs: outcome.elapsedMs,
      note: `${step.sample === 'rung-probe' ? 'rung probe' : 'sample'} ${p.trim!.startSec}–${p.trim!.endSec} s, rate ratio ${ratio.toFixed(3)}${outcome.ssim !== undefined ? `, SSIM ${outcome.ssim.toFixed(4)}` : ''}`,
    });
    if (step.sample === 'rung-probe') {
      s.rungProbe = 'done';
      const main = s.calSamples.filter((c) => c.rungIndex === s.rungIndex && c.ssim !== undefined);
      const mainSsim = main.reduce((a, c) => a + c.ssim!, 0) / Math.max(1, main.length);
      if (outcome.ssim !== undefined && outcome.ssim > mainSsim) {
        s.rungIndex += 1;
        s.ratio = clamp(ratio, ...TUNING.calibration.ratioClamp);
        s.warnings.push({ code: 'rung-probe', message: `A smaller frame looked better at this budget, so Snugclip used ${step.rung.width}x${step.rung.height}.` });
      }
      return startFit(s);
    }
    s.calSamples.push({ rungIndex: s.rungIndex, ratio, ...(outcome.ssim !== undefined ? { ssim: outcome.ssim } : {}) });
    if (s.calSamples.length < s.calWindows.length) return s;
    s.ratio = clamp(median(s.calSamples.map((c) => c.ratio)), ...TUNING.calibration.ratioClamp);
    const ssims = s.calSamples.map((c) => c.ssim).filter((x): x is number => x !== undefined);
    if (ssims.length) {
      const mean = ssims.reduce((a, b) => a + b, 0) / ssims.length;
      s.complexity = complexityFrom(mean);
      const next = s.plan.rungs[s.rungIndex + 1];
      if (mean < TUNING.rungProbeBelow && next && next.bpp >= bppThresholds(s.plan.video!.codec).good) {
        s.rungProbe = 'pending';
        return s;
      }
    }
    return startFit(s);
  }

  // Full or rescue attempt
  const fits = outcome.bytes <= T;
  const bv = Math.max(1, outcome.videoBytes ?? outcome.bytes - s.nonVideoBytes);
  if (outcome.videoBytes !== undefined) s.nonVideoBytes = outcome.bytes - outcome.videoBytes;
  const index = s.attempts.length;
  const attempt: Attempt = {
    index,
    purpose: p.purpose,
    rung: step.rung,
    requestedVideoBitrate: p.video.bitrate,
    bytes: outcome.bytes,
    ...(outcome.videoBytes !== undefined ? { videoBytes: outcome.videoBytes } : {}),
    fits,
    elapsedMs: outcome.elapsedMs,
  };
  s.attempts.push(attempt);
  s.minObservedBytes = s.minObservedBytes === null ? outcome.bytes : Math.min(s.minObservedBytes, outcome.bytes);
  // Best fit: the sharpest rung first (a simple-content rung-up beats a lower rung at similar size),
  // then the most bytes (closest to the target = best quality at that rung).
  const pixRate = step.rung.width * step.rung.height * step.rung.fps;
  if (fits && (!s.best || pixRate > s.best.pixRate || (pixRate === s.best.pixRate && outcome.bytes > s.best.bytes))) s.best = { index, bytes: outcome.bytes, pixRate };
  if (!fits) attempt.note = `over by ${outcome.bytes - T} bytes; discarded`;

  if (p.purpose === 'rescue') {
    s.rescue = 'done';
    if (s.best) s.phase = 'done';
    else {
      s.phase = 'failed';
      s.failure = { code: 'E_FIT_FAILED', message: `No attempt fit under ${T} bytes, including a rescue one rung lower. Nothing was saved.` };
    }
    return s;
  }
  s.fullAttempts += 1;
  const usedBps = (bv * 8) / D;
  if (fits && outcome.bytes < TUNING.acceptFill * T && s.rungIndex > 0 && usedBps < TUNING.rungUp.usedBelow * p.video.bitrate && s.fullAttempts < s.maxAttempts) {
    // Simple content: the encoder couldn't spend the bits. Go up to the largest rung that should fit.
    const cur = step.rung;
    const goalBps = ((Math.floor(T * (1 - s.margin)) - s.nonVideoBytes) * 8) / D;
    const rate = (r: Rung) => r.width * r.height * r.fps;
    let to = s.rungIndex - 1;
    for (let i = s.rungIndex - 1; i >= 0; i--) {
      const r = s.plan.rungs[i]!;
      if (usedBps * (rate(r) / rate(cur)) ** TUNING.rungUp.pixelExponent <= goalBps) to = i;
      else break;
    }
    const up = s.plan.rungs[to]!;
    s.rungIndex = to;
    s.history = [];
    s.nextBitrate = Math.floor(Math.min(goalBps, ceilingFor(s, up)));
    attempt.note = `fits at ${Math.floor((outcome.bytes / T) * 1000) / 10}% but the encoder used only ${Math.round((usedBps / p.video.bitrate) * 100)}% of the bits; simple content, trying ${up.width}x${up.height}`;
    s.warnings.push({ code: 'simple-content', message: `Simple content left room to spare, so Snugclip tried a sharper ${up.width}x${up.height}.` });
    return s;
  }
  if (fits && s.rungIndex === 0 && usedBps < TUNING.rungUp.usedBelow * p.video.bitrate) {
    // Already at the sharpest rung and the encoder can't spend more bits: asking again won't help.
    attempt.note = `fits at ${Math.floor((outcome.bytes / T) * 1000) / 10}%; simple content needs no more bits`;
    s.phase = 'done';
    return s;
  }
  if (fits && (outcome.bytes >= TUNING.acceptFill * T || s.capped)) {
    s.phase = 'done';
    return s;
  }
  if (fits) attempt.note = `fits at ${Math.floor((outcome.bytes / T) * 1000) / 10}% of the target; trying for more quality`;
  else s.margin = Math.min(TUNING.marginCap, s.margin + TUNING.marginStep);

  s.history.push({ req: p.video.bitrate, bv });
  const rung = s.plan.rungs[s.rungIndex]!;
  let slope: number | null = null;
  if (s.history.length >= 2) {
    const a = s.history.at(-2)!;
    const b = s.history.at(-1)!;
    const dr = Math.log(b.req) - Math.log(a.req);
    if (Math.abs(dr) > 1e-4) slope = (Math.log(b.bv) - Math.log(a.bv)) / dr;
  }
  const measuredBps = (bv * 8) / D;
  const floorHit =
    !fits &&
    s.history.length >= 2 &&
    ((slope !== null && slope < TUNING.floorSlope) || (measuredBps > TUNING.floorOvershootFactor * p.video.bitrate && p.video.bitrate < floorBps(s, rung)));

  if (floorHit) {
    if (s.rungIndex < s.plan.rungs.length - 1) {
      const est = measuredBps / p.video.bitrate;
      s.rungIndex += 1;
      s.history = [];
      const nr = s.plan.rungs[s.rungIndex]!;
      s.nextBitrate = Math.floor(Math.min(vbrFor(s, s.rungIndex, s.margin) / est, ceilingFor(s, nr)));
      s.warnings.push({ code: 'encoder-floor', message: `The encoder couldn't go smaller at ${rung.width}x${rung.height}, so Snugclip dropped to ${nr.width}x${nr.height} at ${nr.fps} fps.` });
    } else if (!s.best) {
      s.phase = 'failed';
      s.measuredMinimumBytes = Math.ceil(s.minObservedBytes! * TUNING.measuredMinPad);
      s.failure = { code: 'E_IMPOSSIBLE', message: `Even the smallest settings came out over the target (smallest output: ${s.minObservedBytes} bytes).` };
      return s;
    }
  } else {
    const S = Math.floor(T * (1 - s.margin));
    const goal = Math.max(1, S - s.nonVideoBytes);
    const b = slope === null ? 1 : clamp(slope, ...TUNING.secant.slopeClamp);
    let next = Math.exp(Math.log(p.video.bitrate) + (Math.log(goal) - Math.log(bv)) / b);
    if (!fits && next >= p.video.bitrate) next = p.video.bitrate * 0.97;
    const ceil = ceilingFor(s, rung);
    if (fits && next >= ceil) {
      if (p.video.bitrate >= ceil * 0.999) {
        s.capped = true;
        s.phase = 'done';
        return s;
      }
      next = ceil;
    }
    if (fits && next <= p.video.bitrate) {
      s.phase = 'done';
      return s;
    }
    s.nextBitrate = Math.floor(next);
  }

  if (s.fullAttempts >= s.maxAttempts) {
    if (s.best) s.phase = 'done';
    else {
      // Rescue: one extra attempt one rung lower with a 10% margin (PLAN §4.8).
      const ri = Math.min(s.rungIndex + 1, s.plan.rungs.length - 1);
      const last = s.history.at(-1);
      const est = last ? (last.bv * 8) / D / last.req : 1;
      s.rungIndex = ri;
      s.history = [];
      s.margin = Math.max(s.margin, TUNING.rescueMargin);
      s.nextBitrate = Math.floor(Math.min(vbrFor(s, ri, s.margin) / est, ceilingFor(s, s.plan.rungs[ri]!)));
      s.rescue = 'pending';
    }
  }
  return s;
}

export interface RunFitDeps {
  now: () => number;
  signal: AbortSignalLike;
  onProgress?: (p: FitProgress) => void;
  /** Abort an attempt when progress hasn't advanced for this long (needs `timers`). Web 20 s, ffmpeg 60 s. */
  stallMs?: number;
  /** Injected timers for the stall watchdog; without them there is no watchdog. */
  timers?: Timers;
  inputName?: string;
  inputPath?: string;
  /** Skip the engine probe (the caller already has one). */
  probe?: Probe;
  /** Skip the quality check. */
  skipQuality?: boolean;
}

/** A child abort signal linked to `parent`, built without host globals. */
function childSignal(parent: AbortSignalLike): { signal: AbortSignalLike; abort: (reason?: unknown) => void; dispose: () => void } {
  const listeners = new Set<() => void>();
  const sig = {
    aborted: false,
    reason: undefined as unknown,
    addEventListener: (_t: 'abort', l: () => void) => void listeners.add(l),
    removeEventListener: (_t: 'abort', l: () => void) => void listeners.delete(l),
  };
  const abort = (reason?: unknown) => {
    if (sig.aborted) return;
    sig.aborted = true;
    sig.reason = reason;
    for (const l of Array.from(listeners)) l(); // copy: listeners may unsubscribe while running
  };
  const onParent = () => abort(parent.reason);
  if (parent.aborted) abort(parent.reason);
  else parent.addEventListener('abort', onParent, { once: true });
  return { signal: sig, abort, dispose: () => parent.removeEventListener('abort', onParent) };
}

function cancelled(): SnugclipError {
  return new SnugclipError('E_CANCELLED', 'Cancelled.');
}

/**
 * Probe → plan → (calibrate → encode → correct)* → quality → commit. Returns a Report for every
 * outcome; encode problems never throw. `outputRef` is the committed (or pass-through) output.
 */
export async function runFit<I, O>(engine: Engine<I, O>, input: I, target: Target, options: Partial<Options>, deps: RunFitDeps): Promise<Report & { outputRef?: O }> {
  const { now, signal } = deps;
  const t0 = now();
  const inputName = deps.inputName ?? 'video';
  const report: Report & { outputRef?: O } = {
    snugclip: 'report',
    version: 1,
    createdAt: new Date(t0).toISOString(),
    status: 'error',
    fits: false,
    passThrough: false,
    input: { name: inputName, ...(deps.inputPath ? { path: deps.inputPath } : {}), bytes: 0, probe: null },
    target,
    output: null,
    plan: null,
    attempts: [],
    quality: null,
    warnings: [],
    engine: { id: engine.id, version: '', encoder: '' },
    elapsedMs: 0,
  };
  let overall = 0;
  let expected = 1;
  const emit = (phase: FitProgress['phase'], attempt: number, value: number, etaMs: number | null = null) => {
    overall = Math.max(overall, Math.min(1, value));
    deps.onProgress?.({ phase, attempt, expectedAttempts: expected, overall, elapsedMs: now() - t0, etaMs: phase === 'done' ? 0 : etaMs });
  };
  const finish = () => {
    report.elapsedMs = now() - t0;
    return report;
  };
  let held: O | null = null;
  const discardHeld = async () => {
    if (held !== null) {
      const h = held;
      held = null;
      await engine.discard(h).catch(() => {});
    }
  };

  try {
    emit('probing', 0, 0);
    const probe = deps.probe ?? (await engine.probe(input));
    report.input.bytes = probe.sizeBytes;
    report.input.probe = probe;
    if (signal.aborted) throw cancelled();
    emit('planning', 0, 0.01);
    const caps = await engine.capabilities();
    report.engine.version = caps.version;
    const plan = makePlan(probe, target, options, caps);
    report.plan = plan;
    report.warnings.push(...plan.warnings);
    report.minimumBytes = plan.minimumBytes;
    report.minimumSource = 'planned';
    if (plan.video) report.engine.encoder = caps.encoderName[plan.video.codec] ?? '';

    if (plan.passThrough) {
      report.outputRef = await engine.passThrough(input);
      report.status = 'passthrough';
      report.fits = true;
      report.passThrough = true;
      report.output = passThroughOutput(probe, inputName);
      emit('done', 0, 1);
      return finish();
    }
    if (!plan.feasible) {
      report.status = 'impossible';
      report.error = { code: 'E_IMPOSSIBLE', message: plan.reasons.at(-1) ?? 'The target is too small for this clip.', hint: 'Trim it, mute it, or pick a bigger limit.' };
      emit('done', 0, 1);
      return finish();
    }

    let state = initFitState(probe, target, options, plan, caps);
    const D = plan.durationSec;
    const E = evalShortSide(probe);
    const calShare = state.phase === 'calibrate' ? TUNING.progress.calibration : 0;
    const encEnd = 1 - TUNING.progress.checking;

    for (;;) {
      const step = nextStep(state);
      if (step.kind !== 'encode') break;
      if (signal.aborted) throw cancelled();
      const ep = { ...step.plan, input } as EncodePlan<I>;
      const isCal = ep.purpose === 'calibration';
      const calIdx = state.calSamples.length;
      const calN = Math.max(1, state.calWindows.length);
      const attemptNo = state.fullAttempts + 1;
      if (!isCal) expected = Math.max(expected, attemptNo);
      const startOverall = isCal ? (calShare * Math.min(calIdx, calN - 1)) / calN : Math.max(overall, calShare);
      const span = isCal ? calShare / calN : encEnd - startOverall;
      const len = ep.trim ? ep.trim.endSec - ep.trim.startSec : D;
      const attemptStart = now();
      const child = childSignal(signal);
      let stallTimer: unknown;
      let stalled = false;
      const armStall = () => {
        if (!deps.timers || !deps.stallMs) return;
        if (stallTimer !== undefined) deps.timers.clearTimeout(stallTimer);
        stallTimer = deps.timers.setTimeout(() => {
          stalled = true;
          child.abort('stall');
        }, deps.stallMs);
      };
      armStall();
      let result: EncodeResult<O> | null = null;
      try {
        result = await engine.encode(ep, {
          signal: child.signal,
          onProgress: ({ fraction, encodedSec }) => {
            armStall();
            const el = now() - attemptStart;
            const rate = encodedSec > 0 && el > 0 ? encodedSec / el : 0; // media seconds per ms
            const eta = rate > 0 ? Math.round((Math.max(0, len - encodedSec) + (isCal ? D : 0)) / rate) : null;
            emit(isCal ? 'calibrating' : 'encoding', isCal ? calIdx + 1 : attemptNo, startOverall + span * clamp(fraction, 0, 1), eta);
          },
        });
      } catch (e) {
        if (!(stalled && !signal.aborted)) throw e;
      } finally {
        if (stallTimer !== undefined) deps.timers!.clearTimeout(stallTimer);
        child.dispose();
      }
      const elapsedMs = now() - attemptStart;
      if (!result) {
        state = applyResult(state, step, { stalled: true, elapsedMs });
        continue;
      }
      const measured = { bytes: result.bytes, ...(result.videoBytes !== undefined ? { videoBytes: result.videoBytes } : {}), elapsedMs };
      if (isCal) {
        let ssim: number | undefined;
        try {
          const mid = Math.round(((ep.trim!.endSec - ep.trim!.startSec) / 2) * 1000) / 1000;
          const [a] = await engine.frames(input, [ep.trim!.startSec + mid], E, signal);
          const [b] = await engine.frames(result.output, [mid], E, signal);
          if (a && b) ssim = ssimPair(a, b);
        } catch (e) {
          if (isAbortError(e) || signal.aborted) {
            await engine.discard(result.output).catch(() => {});
            throw e;
          }
        }
        await engine.discard(result.output);
        state = applyResult(state, step, ssim !== undefined ? { ...measured, ssim } : measured);
        continue;
      }
      if (result.encoder) report.engine.encoder = result.encoder;
      const prevBest = state.best;
      state = applyResult(state, step, measured);
      if (state.best !== prevBest && state.best?.index === state.attempts.length - 1) {
        await discardHeld();
        held = result.output;
      } else {
        await engine.discard(result.output);
      }
    }

    report.attempts = state.attempts;
    report.warnings.push(...state.warnings);
    if (state.complexity) report.complexity = state.complexity;
    if (state.phase === 'failed') {
      await discardHeld();
      const f = state.failure!;
      report.status = f.code === 'E_IMPOSSIBLE' ? 'impossible' : 'error';
      report.error = { code: f.code, message: f.message };
      if (state.measuredMinimumBytes) {
        report.minimumBytes = state.measuredMinimumBytes;
        report.minimumSource = 'measured';
      }
      emit('done', 0, 1);
      return finish();
    }
    const heldNow = held as O | null;
    if (heldNow === null || !state.best) throw new SnugclipError('E_INTERNAL', 'fit loop finished without a result');
    const kept = state.attempts[state.best.index]!;
    if (kept.bytes > target.bytes) throw new SnugclipError('E_INTERNAL', 'refusing to commit an over-target output');

    // Quality (PLAN §5), measured before commit.
    if (!deps.skipQuality) {
      emit('checking', 0, encEnd);
      try {
        // Snap sample times onto the output's frame grid so both sides pick the same instant.
        const fpsOut = kept.rung.fps;
        const times = qualityTimes(D, normalizeOptions(options).qualityFrames ?? TUNING.quality.frames).map((t) => Math.round(t * fpsOut) / fpsOut);
        const start = plan.trim?.startSec ?? 0;
        const src = await engine.frames(input, times.map((t) => start + t), E, signal);
        const out = await engine.frames(heldNow, times, E, signal);
        const n = Math.min(src.length, out.length);
        if (n > 0) {
          const pairs: Array<[LumaFrame, LumaFrame]> = Array.from({ length: n }, (_, i) => [src[i]!, out[i]!]);
          const q = quality(pairs);
          report.quality = { ...q, ...verdict(q.ssimMean, q.ssimMin) };
        }
      } catch (e) {
        if (isAbortError(e) || signal.aborted) throw e;
        report.warnings.push({ code: 'quality-skipped', message: `Quality check skipped: ${(e as Error).message}` });
      }
    }
    if (signal.aborted) throw cancelled();
    held = null;
    report.outputRef = await engine.commit(heldNow);
    const r = kept.rung;
    const a = plan.audio;
    report.status = 'fit';
    report.fits = true;
    report.output = {
      name: outputName(inputName, target, plan.container),
      bytes: kept.bytes,
      container: plan.container,
      mime: MIME[plan.container],
      video: { codec: plan.video!.codec, width: r.width, height: r.height, fps: r.fps, bitrate: kept.requestedVideoBitrate },
      audio: a.mode === 'none' ? null : { codec: a.mode === 'copy' ? 'copy' : a.codec!, bitrate: a.bitrate!, channels: a.channels! },
      durationSec: D,
    };
    emit('done', 0, 1);
    return finish();
  } catch (e) {
    await discardHeld();
    if (isAbortError(e) || signal.aborted) {
      report.status = 'cancelled';
      report.fits = false;
      report.output = null;
      delete report.outputRef;
      report.error = { code: 'E_CANCELLED', message: 'Cancelled.' };
      return finish();
    }
    if (isSnugclipError(e)) {
      report.status = e.code === 'E_UNSUPPORTED' || e.code === 'E_UNSUPPORTED_BROWSER' || e.code === 'E_UNSUPPORTED_ENCODER' ? 'unsupported' : 'error';
      report.error = { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) };
      return finish();
    }
    report.status = 'error';
    report.error = { code: 'E_ENCODE', message: (e as Error)?.message ?? String(e) };
    return finish();
  }
}

function passThroughOutput(probe: Probe, inputName: string): Report['output'] {
  const v = probe.video!;
  const container = probe.container === 'webm' ? 'webm' : 'mp4';
  const name = inputName.replace(/\\/g, '/').split('/').pop() || inputName;
  const mime = /^(mov|quicktime)/.test(probe.container) ? 'video/quicktime' : /^(mkv|matroska)/.test(probe.container) ? 'video/x-matroska' : MIME[container];
  return {
    name,
    bytes: probe.sizeBytes,
    container,
    mime,
    // Pass-through keeps the source codec, which may be outside VideoCodecId (e.g. mpeg2video).
    video: { codec: v.codec as VideoCodecId, width: v.displayWidth, height: v.displayHeight, fps: v.fps, bitrate: v.bitrate ?? 0 },
    audio: probe.audio ? { codec: 'copy', bitrate: probe.audio.bitrate ?? 0, channels: probe.audio.channels } : null,
    durationSec: probe.durationSec,
  };
}

// The fit loop: calibrate → encode → measure → correct, driven through the Engine interface.
// Guarantee: an output larger than the target is never kept. If no attempt fits, the result
// is a `failed` report with no output.
import { CORE_VERSION, REPORT_SCHEMA_VERSION } from './constants.js';
import { SnugclipError, isAbortError, isSnugclipError, throwIfAborted } from './errors.js';
import { floorBitrate, overheadBytes, plan as makePlan } from './planner.js';
import { toQualityReport } from './quality.js';
import { TUNING } from './tuning.js';
import type {
  AbortSignalLike,
  Attempt,
  Capabilities,
  EncodeResult,
  EncodeSpec,
  Engine,
  Options,
  OutputInfo,
  Plan,
  Probe,
  QualityReport,
  Report,
  Rung,
  Target,
} from './types.js';

export type FitPhase = 'probing' | 'planning' | 'calibrating' | 'encoding' | 'measuring' | 'done';

export interface FitProgress {
  phase: FitPhase;
  /** Attempt number within the phase (1-based), when relevant. */
  attempt: number;
  /** Progress through the whole job, 0..1 (monotonic). */
  overall: number;
  elapsedMs: number;
  /** Estimated time left, or null until there is enough signal. */
  etaMs: number | null;
}

export interface CompressArgs<I, O> {
  engine: Engine<I, O>;
  input: I;
  target: Target;
  options?: Options;
  /** Skip the engine probe if the caller already has one. */
  probe?: Probe;
  /** Override engine capabilities (tests, forced codec availability). */
  capabilities?: Capabilities;
  signal?: AbortSignalLike;
  onProgress?: (p: FitProgress) => void;
  /** Injectable clock in milliseconds (golden tests). Defaults to Date.now. */
  clock?: () => number;
  maxAttempts?: number;
  calibration?: 'auto' | 'on' | 'off';
  /** Compare frames after encoding (default true when the engine supports it). */
  quality?: boolean | { frames: number };
  /** Input metadata copied into the report. */
  inputInfo?: { path?: string; name?: string };
}

export interface CompressResult<O> {
  report: Report;
  /** The kept output (null for passthrough, impossible, failed). Passthrough means "use the input". */
  output: O | null;
}

function emptyReport(target: Target, inputInfo: CompressArgs<unknown, unknown>['inputInfo'], engine: Engine<unknown, unknown>): Report {
  return {
    kind: 'snugclip.report',
    version: REPORT_SCHEMA_VERSION,
    verdict: 'failed',
    fits: false,
    input: { ...inputInfo, bytes: 0, probe: null },
    target,
    output: null,
    plan: null,
    attempts: [],
    calibration: null,
    quality: null,
    minimumBytes: null,
    warnings: [],
    error: null,
    engine: { name: engine.name, version: engine.version },
    elapsedMs: 0,
  };
}

/** Calibration sample windows (source seconds) for an output range. */
export function calibrationWindows(start: number, duration: number): { start: number; end: number }[] {
  const c = TUNING.calibration.sampleSec;
  const len = Math.min(c.max, Math.max(c.min, duration * c.fraction));
  const n = duration >= 30 ? 3 : 2;
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) {
    const centre = start + (duration * (i + 1)) / (n + 1);
    const s = Math.max(start, Math.min(start + duration - len, centre - len / 2));
    out.push({ start: Math.round(s * 1000) / 1000, end: Math.round((s + len) * 1000) / 1000 });
  }
  return out;
}

/**
 * Next requested bitrate from a log-space secant step. `points` are (requested, actual) video
 * bitrates at the current rung, oldest first. With one point the encoder is assumed
 * proportional (slope 1).
 */
export function secantStep(points: { req: number; act: number }[], goal: number): { next: number; slope: number } {
  const s = TUNING.secant;
  const last = points.at(-1)!;
  let slope = 1;
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i]!;
    const dr = Math.log(last.req) - Math.log(p.req);
    if (Math.abs(dr) > 1e-3) {
      slope = (Math.log(last.act) - Math.log(p.act)) / dr;
      break;
    }
  }
  const clamped = Math.min(s.maxSlope, Math.max(s.minSlope, slope));
  let next = Math.exp(Math.log(last.req) + (Math.log(goal) - Math.log(last.act)) / clamped);
  next = Math.min(last.req * s.maxStepUp, Math.max(last.req * s.maxStepDown, next));
  return { next: Math.floor(next), slope };
}

function withRung(spec: EncodeSpec, r: Rung | Omit<Rung, 'bpp'>, bitrate: number): EncodeSpec {
  const v = spec.video!;
  const b = Math.max(1000, Math.floor(bitrate));
  return {
    ...spec,
    video: {
      ...v,
      width: r.width,
      height: r.height,
      fps: r.fps,
      bitrate: b,
      maxBitrate: Math.floor(b * TUNING.maxrateFactor),
      bufferSize: Math.floor(b * TUNING.bufsizeSeconds),
    },
  };
}

function outputInfo(spec: EncodeSpec, bytes: number, durationSec: number, audioSource: Probe['audio']): OutputInfo {
  const v = spec.video;
  const a = spec.audio;
  return {
    bytes,
    container: spec.container,
    durationSec,
    video: v ? { codec: v.codec, width: v.width, height: v.height, fps: v.fps, bitrate: v.bitrate } : null,
    audio: a ? { codec: a.copy ? (audioSource?.codec ?? a.codec) : a.codec, bitrate: a.bitrate, channels: a.channels } : null,
  };
}

/**
 * Probe → plan → (calibrate → encode → correct)* → quality. Returns a Report for every
 * outcome; only programming errors throw. Cancellation returns verdict `cancelled`.
 */
export async function compress<I, O>(args: CompressArgs<I, O>): Promise<CompressResult<O>> {
  const { engine, input, target, signal } = args;
  const clock = args.clock ?? (() => Date.now());
  const t0 = clock();
  const report = emptyReport(target, args.inputInfo, engine as Engine<unknown, unknown>);
  let overall = 0;
  const progress = (phase: FitPhase, attempt: number, value: number) => {
    overall = Math.max(overall, Math.min(1, value));
    const elapsedMs = clock() - t0;
    const etaMs = overall > 0.05 && overall < 1 ? Math.round((elapsedMs * (1 - overall)) / overall) : overall >= 1 ? 0 : null;
    args.onProgress?.({ phase, attempt, overall, elapsedMs, etaMs });
  };
  const finish = (r: Report) => {
    r.elapsedMs = clock() - t0;
    return r;
  };
  let kept: EncodeResult<O> | null = null;
  const discard = async (res: EncodeResult<O> | null) => {
    if (res) await engine.discard?.(res.output);
  };

  try {
    // Probe
    progress('probing', 0, 0);
    const probe = args.probe ?? (await engine.probe(input, signal ? { signal } : {}));
    report.input.bytes = probe.sizeBytes;
    report.input.probe = probe;
    throwIfAborted(signal);

    // Plan
    progress('planning', 0, 0.01);
    const caps = args.capabilities ?? (await engine.capabilities());
    const plan: Plan = makePlan({ probe, target, options: args.options ?? {}, capabilities: caps });
    report.plan = plan;
    report.target = plan.target;
    report.warnings.push(...plan.warnings);
    report.minimumBytes = plan.minimumBytes;

    if (plan.mode === 'passthrough') {
      report.verdict = 'passthrough';
      report.fits = true;
      report.output = {
        bytes: probe.sizeBytes,
        container: probe.container,
        durationSec: probe.durationSec,
        video: probe.video
          ? { codec: probe.video.codec, width: probe.video.width, height: probe.video.height, fps: probe.video.fps, bitrate: probe.video.bitrate ?? 0 }
          : null,
        audio: probe.audio ? { codec: probe.audio.codec, bitrate: probe.audio.bitrate ?? 0, channels: probe.audio.channels } : null,
      };
      progress('done', 0, 1);
      return { report: finish(report), output: null };
    }
    if (plan.mode === 'impossible') {
      report.verdict = 'impossible';
      report.error = { code: 'IMPOSSIBLE_TARGET', message: plan.reasons.at(-1) ?? 'Target is too small for this clip.' };
      progress('done', 0, 1);
      return { report: finish(report), output: null };
    }

    const spec0 = plan.spec!;
    const video0 = spec0.video!;
    const duration = plan.durationSec;
    const trimStart = plan.options.trim?.start ?? 0;
    const maxAttempts = args.maxAttempts ?? TUNING.maxAttempts;
    const nonVideoEstimate = (spec: EncodeSpec) =>
      plan.budget.audioBytes + overheadBytes(spec.container, duration, spec.video!.fps, spec.audio ? { sampleRate: spec.audio.sampleRate, codec: spec.audio.codec } : null);

    // Calibration
    const calMode = args.calibration ?? 'auto';
    const doCal =
      calMode === 'on'
        ? duration >= TUNING.calibration.minDurationOn
        : calMode === 'auto'
          ? caps.rateControl === 'one-pass' && duration >= TUNING.calibration.minDurationAuto
          : false;
    let ratio = 1;
    let rungIndex = plan.rungIndex;
    const ladder = plan.ladder;
    const encodeShare = doCal ? [0.12, 0.9] : [0.02, 0.9];
    if (doCal) {
      const windows = calibrationWindows(trimStart, duration);
      const logs: number[] = [];
      for (let i = 0; i < windows.length; i++) {
        throwIfAborted(signal);
        const w = windows[i]!;
        const spec: EncodeSpec = { ...withRung(spec0, ladder[rungIndex]!, video0.bitrate), audio: null, trim: w, sample: true };
        const ta = clock();
        const base = 0.02 + (0.1 * i) / windows.length;
        const res = await engine.encode(input, spec, {
          ...(signal ? { signal } : {}),
          onProgress: (f) => progress('calibrating', i + 1, base + (0.1 / windows.length) * f),
        });
        const len = w.end - w.start;
        const vBytes = res.videoBytes ?? Math.max(1, res.bytes - overheadBytes(spec.container, len, spec.video!.fps, null));
        const act = (vBytes * 8) / len;
        const r = act / video0.bitrate;
        logs.push(Math.log(r));
        report.attempts.push({
          kind: 'sample',
          n: i + 1,
          width: spec.video!.width,
          height: spec.video!.height,
          fps: spec.video!.fps,
          requestedVideoBitrate: video0.bitrate,
          bytes: res.bytes,
          actualVideoBitrate: Math.round(act),
          fits: true,
          kept: false,
          elapsedMs: clock() - ta,
          note: `sample ${w.start.toFixed(2)}–${w.end.toFixed(2)} s, ratio ${r.toFixed(3)}`,
        });
        await discard(res);
      }
      const [lo, hi] = TUNING.calibration.ratioClamp;
      ratio = Math.min(hi, Math.max(lo, Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length)));
      report.calibration = { samples: windows.length, ratio: Math.round(ratio * 1000) / 1000 };
    }

    // Encode, measure, correct
    let overshoots = 0;
    // Aim: the plan's goal (target × goalFill, or lower when the plan capped the bitrate).
    // Each overshoot lowers the aim a little further below the target.
    let aim = Math.min(plan.budget.goalBytes, target.bytes * TUNING.goalFill);
    const acceptBytes = () => Math.min(target.bytes * TUNING.acceptFill, aim * (TUNING.acceptFill / TUNING.goalFill));
    const goalVideoBitrate = (nonVideoBytes: number) => Math.max(1000, ((aim - nonVideoBytes) * 8) / duration);
    let spec = withRung(spec0, ladder[rungIndex]!, video0.bitrate / ratio);
    let points: { req: number; act: number }[] = [];
    let lastNonVideo = nonVideoEstimate(spec);
    const encodeAttempts: Attempt[] = [];
    let keptSpec: EncodeSpec | null = null;
    for (let n = 1; n <= maxAttempts; n++) {
      throwIfAborted(signal);
      // Floor rule: a request below the rung's floor bpp means the encoder can't honour it
      // at this size; drop a rung (keeping the measured ratio) instead of encoding garbage.
      while (spec.video!.bitrate < floorBitrate(ladder[rungIndex]!, spec.video!.codec) && rungIndex < ladder.length - 1) {
        rungIndex++;
        const r = ladder[rungIndex]!;
        const est = points.length ? points.at(-1)!.act / points.at(-1)!.req : ratio;
        lastNonVideo = nonVideoEstimate(withRung(spec, r, 1000));
        spec = withRung(spec, r, goalVideoBitrate(lastNonVideo) / est);
        points = [];
        report.warnings.push(`Dropped to ${r.width}x${r.height} at ${r.fps} fps to stay under the target.`);
      }
      const ta = clock();
      const startOverall = n === 1 ? encodeShare[0]! : overall;
      const span = encodeShare[1]! - startOverall;
      const res = await engine.encode(input, spec, {
        ...(signal ? { signal } : {}),
        onProgress: (f) => progress('encoding', n, startOverall + span * (n === 1 ? f : f * 0.5)),
      });
      const fits = res.bytes <= target.bytes;
      const nonVideo = res.videoBytes !== undefined ? res.bytes - res.videoBytes : nonVideoEstimate(spec);
      const vBytes = Math.max(1, res.videoBytes ?? res.bytes - nonVideo);
      const act = (vBytes * 8) / duration;
      lastNonVideo = nonVideo;
      const attempt: Attempt = {
        kind: 'encode',
        n,
        width: spec.video!.width,
        height: spec.video!.height,
        fps: spec.video!.fps,
        requestedVideoBitrate: spec.video!.bitrate,
        bytes: res.bytes,
        actualVideoBitrate: Math.round(act),
        fits,
        kept: false,
        elapsedMs: clock() - ta,
      };
      encodeAttempts.push(attempt);
      report.attempts.push(attempt);
      if (res.encoder) report.engine = { name: engine.name, version: engine.version, encoder: res.encoder };

      if (fits) {
        // Keep the largest fitting output (closest to the target = best quality).
        if (!kept || res.bytes > kept.bytes) {
          await discard(kept);
          if (kept) for (const a of encodeAttempts) if (a !== attempt) a.kept = false;
          kept = res;
          attempt.kept = true;
          keptSpec = spec;
        } else {
          await discard(res);
        }
        if (res.bytes >= acceptBytes()) break;
        attempt.note = 'fits but undershoots; trying for more quality';
      } else {
        await discard(res);
        overshoots++;
        aim = Math.min(aim, target.bytes * Math.max(TUNING.minGoalFill, TUNING.goalFill - TUNING.overshootBackoff * overshoots));
        attempt.note = `over target by ${res.bytes - target.bytes} bytes; discarded`;
      }
      if (n === maxAttempts) break;
      points.push({ req: spec.video!.bitrate, act });
      const goal = goalVideoBitrate(lastNonVideo);
      let { next, slope } = secantStep(points, goal);
      if (!fits && next >= spec.video!.bitrate) next = Math.floor(spec.video!.bitrate * 0.9);
      if (kept && fits && next <= spec.video!.bitrate) break; // can't improve an undershoot
      // Encoder floor: we asked for less and got about the same. Drop a rung.
      if (!fits && points.length >= 2 && slope < 0.35 && rungIndex < ladder.length - 1) {
        rungIndex++;
        const r = ladder[rungIndex]!;
        const est = act / spec.video!.bitrate;
        spec = withRung(spec, r, goal / est);
        points = [];
        report.warnings.push(`Encoder floor hit; dropped to ${r.width}x${r.height} at ${r.fps} fps.`);
        continue;
      }
      spec = withRung(spec, ladder[rungIndex]!, next);
    }

    if (!kept) {
      report.verdict = 'failed';
      report.error = {
        code: 'COULD_NOT_FIT',
        message: `No attempt fit under ${target.bytes} bytes after ${encodeAttempts.length} tries; nothing was saved. Try a smaller max height, trimming, or muting.`,
      };
      progress('done', 0, 1);
      return { report: finish(report), output: null };
    }

    if (!keptSpec) throw new SnugclipError('INTERNAL', 'kept output without a spec');
    report.output = outputInfo(keptSpec, kept.bytes, duration, probe.audio);
    report.verdict = 'fits';
    report.fits = true;
    if (keptSpec.video && (keptSpec.video.width !== video0.width || keptSpec.video.height !== video0.height)) {
      report.plan = { ...plan, rungIndex };
    }

    // Quality
    const q = args.quality ?? true;
    if (q && engine.measureQuality) {
      progress('measuring', 0, 0.9);
      const frames = typeof q === 'object' ? q.frames : TUNING.quality.frames;
      try {
        const m = await engine.measureQuality(input, kept.output, keptSpec, { frames, ...(signal ? { signal } : {}) });
        report.quality = toQualityReport(m) satisfies QualityReport;
      } catch (e) {
        if (isAbortError(e)) throw e;
        report.warnings.push(`Quality check skipped: ${(e as Error).message}`);
      }
    }
    progress('done', 0, 1);
    return { report: finish(report), output: kept.output };
  } catch (e) {
    await discard(kept).catch(() => {});
    kept = null;
    if (isAbortError(e) || signal?.aborted) {
      report.verdict = 'cancelled';
      report.fits = false;
      report.output = null;
      report.error = { code: 'CANCELLED', message: 'Cancelled.' };
      return { report: finish(report), output: null };
    }
    if (isSnugclipError(e)) {
      report.verdict = e.code === 'UNSUPPORTED_INPUT' || e.code === 'UNSUPPORTED_BROWSER' ? 'unsupported' : 'failed';
      report.error = { code: e.code, message: e.message };
      return { report: finish(report), output: null };
    }
    report.verdict = 'failed';
    report.error = { code: 'ENCODE_FAILED', message: (e as Error)?.message ?? String(e) };
    return { report: finish(report), output: null };
  }
}

/** Convenience: just the plan for a probe (the `snugclip plan` dry run). */
export { makePlan as planCompression };
export { SnugclipError };

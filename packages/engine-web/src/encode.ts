// One engine encode (PLAN §8.2–8.3, §8.6): mediabunny Conversion by default; the manual
// VideoSampleSink → VideoSampleSource pipeline when latencyMode 'realtime' is needed (Conversion
// has no latencyMode option in 1.60.0). Browser-only; the decisions are in conversion-options.ts.
import type { AbortSignalLike, EncodePlan, EncodeProgress, EncodeResult } from '@snugclip/core';
import { SnugclipError, throwIfAborted } from '@snugclip/core';
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny';
import type { ConversionVideoOptions, InputTrack, InputVideoTrack, OutputFormat, Target } from 'mediabunny';
import { encoderLabel, mimeFor } from './codec-strings.js';
import {
  assessDiscarded,
  buildAudioOptions,
  buildVideoEncodingConfig,
  buildVideoOptions,
  chooseTargetKind,
  conversionTrim,
  effectiveLatency,
  estimateOutputBytes,
  nextUntil,
  outputFormatSpec,
  QUOTA_HEADROOM,
  resolveRange,
} from './conversion-options.js';
import type { DiscardReason, MediaRange, TargetKind } from './conversion-options.js';
import { mapEngineError } from './errors-map.js';
import type { LatencyMode } from './latency-probe.js';
import { createOpfsSink, ensureQuota, opfsAvailable } from './opfs.js';
import type { OpfsSink } from './opfs.js';
import { holdWhilePaused } from './pause.js';
import type { PauseGate } from './pause.js';

export interface EncodeContext {
  /** Result of the Safari latency probe at capability time. */
  probedLatency: LatencyMode;
  pause?: PauseGate;
  /** Called with each OPFS-backed output so discard() can delete its file. */
  onOpfsOutput?: (blob: Blob, sink: OpfsSink) => void;
}

type VideoProcess = NonNullable<ConversionVideoOptions['process']>;

/**
 * HDR → SDR (PLAN §8.6): draws each (already resized) frame onto an sRGB 2D canvas, where the
 * browser tone-maps approximately, and hands the encoder an 8-bit sRGB frame. The canvas is
 * reused: `new VideoSample(canvas)` snapshots it into a VideoFrame immediately.
 */
function hdrToSdrProcess(width: number, height: number): VideoProcess {
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  return (sample) => {
    if (!canvas || !ctx) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!ctx) throw new SnugclipError('E_ENCODE', 'No 2D canvas for HDR to SDR conversion.');
    }
    sample.drawWithFit(ctx, { fit: 'fill' });
    return new VideoSample(canvas, { timestamp: sample.timestamp, duration: sample.duration });
  };
}

function makeFormat(plan: EncodePlan<Blob>, kind: TargetKind): OutputFormat {
  const spec = outputFormatSpec(plan.container, kind);
  return spec.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: spec.fastStart });
}

interface Sink {
  target: Target;
  finish(): Promise<Blob>;
  abort(): Promise<void>;
  opfs?: OpfsSink;
}

async function makeSink(plan: EncodePlan<Blob>, kind: TargetKind, estimate: number): Promise<Sink> {
  const mime = mimeFor(plan.container);
  if (kind === 'opfs') {
    await ensureQuota(Math.ceil(estimate * QUOTA_HEADROOM));
    const opfs = await createOpfsSink(plan.container);
    return { target: opfs.target, finish: () => opfs.finish(), abort: () => opfs.remove(), opfs };
  }
  const target = new BufferTarget();
  return {
    target,
    finish: async () => {
      if (!target.buffer) throw new SnugclipError('E_ENCODE', 'The encoder produced no data.');
      return new Blob([target.buffer], { type: mime });
    },
    abort: async () => {},
  };
}

/** Sums packet bytes per track type in a finished output (exact: from the container index). */
export async function countTrackBytes(blob: Blob): Promise<{ videoBytes?: number; audioBytes?: number; durationSec?: number }> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const sum = async (track: InputTrack) => {
      let total = 0;
      for await (const p of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) total += p.byteLength;
      return total;
    };
    const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const out: { videoBytes?: number; audioBytes?: number; durationSec?: number } = {};
    if (v) out.videoBytes = await sum(v);
    if (a) out.audioBytes = await sum(a);
    out.durationSec = await input.computeDuration();
    return out;
  } finally {
    input.dispose();
  }
}

function discardedList(c: Conversion): Array<{ type: string; reason: DiscardReason }> {
  return c.discardedTracks.map((d) => ({ type: d.track.isVideoTrack() ? 'video' : d.track.isAudioTrack() ? 'audio' : 'other', reason: d.reason }));
}

type Progress = (p: EncodeProgress) => void;

function progressReporter(range: MediaRange, onProgress?: Progress) {
  let last: EncodeProgress = { fraction: 0, encodedSec: 0 };
  return {
    report(fraction: number, encodedSec: number) {
      const f = Math.min(1, Math.max(last.fraction, Number.isFinite(fraction) ? fraction : 0));
      const s = Math.min(range.len || Infinity, Math.max(last.encodedSec, Number.isFinite(encodedSec) ? encodedSec : 0));
      last = { fraction: f, encodedSec: s };
      onProgress?.(last);
    },
    heartbeat() {
      onProgress?.(last);
    },
    get last() {
      return last;
    },
  };
}

async function runConversion(
  input: Input,
  output: Output,
  plan: EncodePlan<Blob>,
  range: MediaRange,
  signal: AbortSignalLike,
  ctx: EncodeContext,
  onProgress?: Progress,
): Promise<void> {
  const process = plan.hdrToSdr ? hdrToSdrProcess(plan.video.width, plan.video.height) : undefined;
  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    trim: conversionTrim(range, plan.trim),
    video: buildVideoOptions(plan, process),
    audio: buildAudioOptions(plan.audio),
    tags: {}, // strip source metadata (location, device) — smaller and private
    showWarnings: false,
  });
  const problem = assessDiscarded(discardedList(conversion), { video: true, audio: plan.audio.mode !== 'none' });
  if (problem) throw problem;
  if (!conversion.isValid) throw new SnugclipError('E_UNSUPPORTED', "This file can't be converted in the browser.");

  const progress = progressReporter(range, onProgress);
  conversion.onProgress = (p, t) => progress.report(p, t);
  const onAbort = () => void conversion.cancel();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfAborted(signal);
    const gate = ctx.pause;
    if (!gate) {
      await conversion.execute();
      return;
    }
    // Stepped execution so a pause takes effect within ~2 s of output (or at once with onPause).
    let until = 0;
    let interrupted = false;
    while (conversion.state !== 'done') {
      await holdWhilePaused(gate, { signal, heartbeat: () => progress.heartbeat() });
      until = nextUntil(until, progress.last.encodedSec, range.len, interrupted);
      const pauseCtl = gate.onPause ? new AbortController() : undefined;
      let pausedMidStep = false;
      const unsubscribe = gate.onPause?.(() => {
        pausedMidStep = true;
        pauseCtl?.abort();
      });
      try {
        await conversion.execute(until === Infinity ? { pauseSignal: pauseCtl?.signal } : { until, pauseSignal: pauseCtl?.signal });
      } finally {
        unsubscribe?.();
      }
      interrupted = pausedMidStep;
      throwIfAborted(signal);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function runManual(
  input: Input,
  output: Output,
  plan: EncodePlan<Blob>,
  range: MediaRange,
  signal: AbortSignalLike,
  ctx: EncodeContext,
  onProgress?: Progress,
): Promise<void> {
  const track: InputVideoTrack | null = await input.getPrimaryVideoTrack();
  if (!track) throw new SnugclipError('E_UNSUPPORTED', 'This file has no video track.');
  if (!(await track.canDecode())) {
    throw new SnugclipError('E_UNSUPPORTED', "This browser can't decode this video.", {
      hint: 'Snugclip handles MP4, MOV, M4V, WebM and MKV with H.264, HEVC, VP9 or AV1. The CLI (ffmpeg) can do this one.',
    });
  }
  const process = plan.hdrToSdr ? hdrToSdrProcess(plan.video.width, plan.video.height) : undefined;
  const source = new VideoSampleSource(buildVideoEncodingConfig(plan, 'realtime', process ? { process } : {}));
  output.addVideoTrack(source, { frameRate: plan.video.fps });

  // Audio rides along as a composable Conversion into the same Output (copy/encode/resample, AAC
  // encoder and trim handled by mediabunny exactly as on the normal path).
  let audio: Conversion | null = null;
  if (plan.audio.mode !== 'none') {
    audio = await Conversion.init({
      input,
      output,
      composable: true,
      tracks: 'primary',
      trim: conversionTrim(range, plan.trim),
      video: { discard: true },
      audio: buildAudioOptions(plan.audio),
      showWarnings: false,
    });
    const problem = assessDiscarded(discardedList(audio), { video: false, audio: true });
    if (problem) throw problem;
    if (!audio.utilizedTracks.some((t) => t.isAudioTrack())) throw new SnugclipError('E_UNSUPPORTED', "This file's audio can't be converted in the browser.");
  }

  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
    void audio?.cancel();
    void output.cancel();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const progress = progressReporter(range, onProgress);
  try {
    await output.start();
    const videoPump = async () => {
      const sink = new VideoSampleSink(track);
      for await (const sample of sink.samples(range.start, Number.isFinite(range.end) ? range.end : undefined)) {
        try {
          if (cancelled) break;
          const s0 = Math.max(range.start, sample.timestamp);
          const s1 = Math.min(range.end, sample.timestamp + sample.duration);
          if (s0 >= s1) continue;
          sample.setTimestamp(s0 - range.start);
          sample.setDuration(s1 - s0);
          await source.add(sample);
          const done = s1 - range.start;
          progress.report(range.len > 0 ? done / range.len : 0, done);
        } finally {
          sample.close();
        }
        if (ctx.pause) await holdWhilePaused(ctx.pause, { signal, heartbeat: () => progress.heartbeat() });
      }
      source.close();
    };
    try {
      await Promise.all([videoPump(), audio ? audio.execute() : Promise.resolve()]);
    } catch (e) {
      // A composable conversion doesn't own the Output: stop it explicitly so it can't linger.
      if (audio && audio.state !== 'done' && audio.state !== 'canceled') await audio.cancel().catch(() => {});
      throw e;
    }
    throwIfAborted(signal);
    await output.finalize();
    progress.report(1, range.len);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function encodeBlob(
  plan: EncodePlan<Blob>,
  opts: { signal: AbortSignalLike; onProgress?: Progress },
  ctx: EncodeContext,
): Promise<EncodeResult<Blob>> {
  const { signal } = opts;
  throwIfAborted(signal);
  const input = new Input({ source: new BlobSource(plan.input), formats: ALL_FORMATS });
  let sink: Sink | null = null;
  let output: Output | null = null;
  try {
    const range = resolveRange(plan.trim, await input.computeDuration());
    if (!(range.len > 0)) throw new SnugclipError('E_TRIM', 'Nothing to encode in the chosen range.');
    const estimate = estimateOutputBytes(plan, range.len);
    const kind = chooseTargetKind(estimate, { opfsAvailable: opfsAvailable() });
    sink = await makeSink(plan, kind, estimate);
    output = new Output({ format: makeFormat(plan, kind), target: sink.target });
    const latency = effectiveLatency(plan.video.latency, ctx.probedLatency);
    if (latency === 'realtime') await runManual(input, output, plan, range, signal, ctx, opts.onProgress);
    else await runConversion(input, output, plan, range, signal, ctx, opts.onProgress);
    throwIfAborted(signal);
    const blob = await sink.finish();
    if (sink.opfs) ctx.onOpfsOutput?.(blob, sink.opfs);
    const counts = await countTrackBytes(blob).catch(() => null);
    const result: EncodeResult<Blob> = {
      output: blob,
      bytes: blob.size,
      durationSec: counts?.durationSec && counts.durationSec > 0 ? counts.durationSec : range.len,
      encoder: encoderLabel(plan.video.codec, latency),
    };
    if (counts?.videoBytes !== undefined) result.videoBytes = counts.videoBytes;
    if (counts?.audioBytes !== undefined) result.audioBytes = counts.audioBytes;
    return result;
  } catch (e) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    await sink?.abort().catch(() => {});
    throw mapEngineError(e, signal, 'encode');
  } finally {
    input.dispose();
  }
}

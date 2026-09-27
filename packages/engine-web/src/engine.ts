// createWebEngine(): the core `Engine<Blob, Blob>` for browsers (PLAN §4.9, §8.2). Worker-safe:
// no window/document; frames go through OffscreenCanvas (CanvasSink picks it in workers). The app
// owns the worker and calls core runFit() inside it.
import type { AbortSignalLike, EncodePlan, EncodeProgress, EncodeResult, Engine, EngineCapabilities, LumaFrame, Probe } from '@snugclip/core';
import { canEncodeAudio, canEncodeVideo, Logging, LogLevel, Quality } from 'mediabunny';
import { loadAacEncoderOnce } from './aac-loader.js';
import type { AacLoaderDeps } from './aac-loader.js';
import { buildCapabilities, emptyEncodeTable, PROBE_TIERS, probeBitrate } from './capabilities.js';
import type { CapabilityInputs } from './capabilities.js';
import { toMediabunnyVideoCodec, VIDEO_CODEC_IDS } from './codec-strings.js';
import { encodeBlob } from './encode.js';
import { mapEngineError } from './errors-map.js';
import { decodeFrames } from './frames.js';
import { probeEncoderLatency } from './latency-probe.js';
import type { LatencyMode } from './latency-probe.js';
import type { OpfsSink } from './opfs.js';
import type { PauseGate } from './pause.js';
import { probeBlob } from './probe.js';

export interface WebEngineOptions {
  /**
   * URL of `@mediabunny/aac-encoder`'s bundle, served unmodified by the app. Loaded only when the
   * browser has no native AAC encoder (Firefox, Safari < 26), at capabilities() time, so a failed
   * load lets the planner fall back to WebM (VP9 + Opus).
   */
  aacEncoderUrl?: string;
  /** Awaited between encode chunks; see PauseGate. */
  pause?: PauseGate;
  /** Run the Safari stall probe (PLAN §8.3) at capabilities() time. Default true. */
  latencyProbe?: boolean;
  /** Called when the AAC encoder fails to load (the engine carries on without AAC). */
  onWarning?: (w: { code: string; message: string }) => void;
  /** Test seam for the AAC loader's browser functions. */
  aacLoaderDeps?: Partial<AacLoaderDeps>;
}

export interface WebEngine extends Engine<Blob, Blob> {
  /** Latency mode chosen by the stall probe (known after capabilities()). */
  readonly latencyMode: LatencyMode;
  /** Whether AAC comes from the lazily loaded encoder rather than the browser. */
  readonly aacPolyfilled: boolean;
}

async function probeCapabilityInputs(opts: WebEngineOptions, state: { aacPolyfilled: boolean }): Promise<CapabilityInputs> {
  const video = emptyEncodeTable();
  if (typeof VideoEncoder !== 'undefined') {
    await Promise.all(
      VIDEO_CODEC_IDS.flatMap((codec) =>
        PROBE_TIERS.map(async ({ tier, width, height }) => {
          try {
            video[codec][tier] = await canEncodeVideo(toMediabunnyVideoCodec(codec), {
              width,
              height,
              frameRate: 30,
              quality: new Quality({ bitrate: probeBitrate(width, height) }),
            });
          } catch {
            video[codec][tier] = false;
          }
        }),
      ),
    );
  }
  const audioOpts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 128_000 }) };
  const check = (c: 'aac' | 'opus') => canEncodeAudio(c, audioOpts).catch(() => false);
  let [aac, opus] = await Promise.all([check('aac'), check('opus')]);
  if (!aac && opts.aacEncoderUrl) {
    try {
      await loadAacEncoderOnce(opts.aacEncoderUrl, opts.aacLoaderDeps);
      aac = await check('aac');
      state.aacPolyfilled = aac;
    } catch (e) {
      opts.onWarning?.({ code: 'aac-encoder-load-failed', message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { video, audio: { aac, opus } };
}

export function createWebEngine(opts: WebEngineOptions = {}): WebEngine {
  // mediabunny prints discarded-track and fallback notices; the engine reports those itself.
  if (Logging.level > LogLevel.Errors) Logging.level = LogLevel.Errors;

  const state = { latency: 'quality' as LatencyMode, aacPolyfilled: false };
  let capsPromise: Promise<EngineCapabilities> | null = null;
  const opfsOutputs = new WeakMap<Blob, OpfsSink>();

  const capabilities = (): Promise<EngineCapabilities> => {
    if (!capsPromise) {
      capsPromise = (async () => {
        const [inputs, latency] = await Promise.all([
          probeCapabilityInputs(opts, state),
          opts.latencyProbe === false ? Promise.resolve<LatencyMode>('quality') : probeEncoderLatency(),
        ]);
        state.latency = latency;
        return buildCapabilities(inputs);
      })();
      capsPromise.catch(() => (capsPromise = null));
    }
    return capsPromise;
  };

  return {
    id: 'web',
    get latencyMode() {
      return state.latency;
    },
    get aacPolyfilled() {
      return state.aacPolyfilled;
    },
    capabilities,
    probe(input: Blob): Promise<Probe> {
      return probeBlob(input);
    },
    async encode(plan: EncodePlan<Blob>, o: { signal: AbortSignalLike; onProgress?: (p: EncodeProgress) => void }): Promise<EncodeResult<Blob>> {
      await capabilities(); // AAC encoder registration and the latency probe happen there
      return encodeBlob(plan, o, {
        probedLatency: state.latency,
        ...(opts.pause ? { pause: opts.pause } : {}),
        onOpfsOutput: (blob, sink) => opfsOutputs.set(blob, sink),
      });
    },
    async frames(src: Blob, timesSec: number[], evalShortSide: number, signal: AbortSignalLike): Promise<LumaFrame[]> {
      try {
        return await decodeFrames(src, timesSec, evalShortSide, signal);
      } catch (e) {
        throw mapEngineError(e, signal, 'frames');
      }
    },
    async passThrough(input: Blob): Promise<Blob> {
      return input;
    },
    async commit(output: Blob): Promise<Blob> {
      return output;
    },
    async discard(output: Blob): Promise<void> {
      const sink = opfsOutputs.get(output);
      if (sink) {
        opfsOutputs.delete(output);
        await sink.remove();
      }
      // In-memory outputs are released when the last reference goes (the app revokes object URLs).
    },
  };
}

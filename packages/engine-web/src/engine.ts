// createWebEngine(): the core `Engine<Blob, Blob>` for browsers (PLAN §4.9, §8.2). Worker-safe:
// no window/document; frames go through OffscreenCanvas (CanvasSink picks it in workers). The app
// owns the worker and calls core runFit() inside it.
import type { AbortSignalLike, EncodePlan, EncodeProgress, EncodeResult, Engine, EngineCapabilities, LumaFrame, Probe } from '@snugclip/core';
import { canEncodeAudio, canEncodeVideo, Logging, LogLevel, Quality } from 'mediabunny';
import { loadAacEncoderOnce, setAacRoute } from './aac-loader.js';
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
import { aacNeedsWasm, type AacRouting } from './aac-routing.js';
import { isAbortError, SnugclipError } from '@snugclip/core';

export interface WebEngineOptions {
  /**
   * URL of `@mediabunny/aac-encoder`'s bundle, served unmodified by the app. It encodes every AAC
   * config native AAC can't do safely (below 96 kbps; core TUNING.nativeAacSafe) and all AAC when
   * the browser has none (Firefox, Safari < 26). Loaded at capabilities() time only when there is no
   * native AAC; otherwise lazily, on the first encode that needs it. Without it, AAC budgets below
   * 96 kbps are avoided by the planner.
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
  /** Whether the WASM AAC encoder has been loaded (it takes only configs native AAC can't do safely). */
  readonly aacPolyfilled: boolean;
  /** AAC encoder used by the last encode: native WebCodecs, WASM, or none. */
  readonly lastAudioEncoder: 'native' | 'wasm' | null;
}

interface EngineState {
  latency: LatencyMode;
  aacPolyfilled: boolean;
  aac: AacRouting;
  lastAudioEncoder: 'native' | 'wasm' | null;
}

async function probeCapabilityInputs(opts: WebEngineOptions, state: EngineState): Promise<CapabilityInputs> {
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
  // Audio: isConfigSupported only (mediabunny's canEncodeAudio). No AudioEncoder is ever created
  // here: low-bitrate native AAC encodes can abort the GPU process (core TUNING.nativeAacSafe).
  // Checked before any WASM registration so the answer reflects the browser alone.
  const audioOpts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 128_000 }) };
  const check = (c: 'aac' | 'opus') => canEncodeAudio(c, audioOpts).catch(() => false);
  const [nativeAac, opus] = await Promise.all([check('aac'), check('opus')]);
  state.aac.native = nativeAac;
  state.aac.wasmAvailable = !!opts.aacEncoderUrl;
  if (!nativeAac && opts.aacEncoderUrl) {
    // No native AAC at all (Firefox, Safari < 26): every AAC encode needs WASM, so load it now and
    // let a failure steer the planner to WebM.
    try {
      await ensureWasmAac(opts, state);
    } catch (e) {
      state.aac.wasmAvailable = false;
      opts.onWarning?.({ code: 'aac-encoder-load-failed', message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { video, audio: { aac: state.aac.native || state.aac.wasmAvailable, opus }, aac: state.aac };
}

async function ensureWasmAac(opts: WebEngineOptions, state: EngineState): Promise<void> {
  if (!opts.aacEncoderUrl || !state.aac.wasmAvailable) {
    throw new SnugclipError('E_UNSUPPORTED_ENCODER', 'This audio needs the WASM AAC encoder, which is not available.');
  }
  try {
    await loadAacEncoderOnce(opts.aacEncoderUrl, opts.aacLoaderDeps);
  } catch (e) {
    state.aac.wasmAvailable = false;
    throw new SnugclipError('E_UNSUPPORTED_ENCODER', `The AAC encoder couldn't be loaded: ${e instanceof Error ? e.message : String(e)}`);
  }
  state.aacPolyfilled = true;
}

/** Whether an encode plan will use the WASM AAC encoder, native AAC, or no AAC encoder. */
function aacPathFor(plan: EncodePlan<Blob>, state: EngineState): 'native' | 'wasm' | null {
  const a = plan.audio;
  if (a.mode !== 'encode' || a.codec !== 'aac') return null;
  return aacNeedsWasm(state.aac, a.bitrate ?? 0, a.channels ?? 2, a.sampleRate ?? 48000) ? 'wasm' : 'native';
}

export function createWebEngine(opts: WebEngineOptions = {}): WebEngine {
  // mediabunny prints discarded-track and fallback notices; the engine reports those itself.
  if (Logging.level > LogLevel.Errors) Logging.level = LogLevel.Errors;

  const state: EngineState = { latency: 'quality', aacPolyfilled: false, aac: { native: false, wasmAvailable: false, nativeFailed: false }, lastAudioEncoder: null };
  // WASM AAC takes exactly the configs the routing sends it; native AAC keeps the allowlist.
  setAacRoute((cfg) => aacNeedsWasm(state.aac, cfg.bitrate ?? 0, cfg.numberOfChannels, cfg.sampleRate));
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
    get lastAudioEncoder() {
      return state.lastAudioEncoder;
    },
    capabilities,
    probe(input: Blob): Promise<Probe> {
      return probeBlob(input);
    },
    async encode(plan: EncodePlan<Blob>, o: { signal: AbortSignalLike; onProgress?: (p: EncodeProgress) => void }): Promise<EncodeResult<Blob>> {
      await capabilities(); // the latency probe and native-AAC check happen there
      const run = async () => {
        const path = aacPathFor(plan, state);
        if (path === 'wasm') await ensureWasmAac(opts, state);
        state.lastAudioEncoder = path;
        const r = await encodeBlob(plan, o, {
          probedLatency: state.latency,
          ...(opts.pause ? { pause: opts.pause } : {}),
          onOpfsOutput: (blob, sink) => opfsOutputs.set(blob, sink),
        });
        return path === 'wasm' ? { ...r, encoder: `${r.encoder}+aac-wasm` } : r;
      };
      try {
        return await run();
      } catch (e) {
        // A native AAC encode failed: never retry native; redo this job with WASM AAC if we can.
        if (state.lastAudioEncoder !== 'native' || isAbortError(e) || o.signal.aborted || !state.aac.wasmAvailable) throw e;
        state.aac.nativeFailed = true;
        opts.onWarning?.({ code: 'aac-native-failed', message: 'The browser\'s AAC encoder failed; switching to the built-in WASM AAC encoder.' });
        return await run();
      }
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

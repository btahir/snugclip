// A deterministic scripted Engine for the fit-loop tests (PLAN §15): bytes = f(bitrate, rung)
// with an injectable overshoot, encoder floor, per-attempt drift and stall.
import { MB, overheadBytes } from '../src/index.js';
import type { AbortSignalLike, EncodePlan, EncodeResult, Engine, EngineCapabilities, LumaFrame, Probe, VideoCodecId } from '../src/index.js';

export interface RateModel {
  /** actual video bitrate = requested × ratio (before the floor). */
  ratio?: number;
  /** Encoder floor in bits per pixel per frame: actual ≥ floorBpp·w·h·fps. */
  floorBpp?: number;
  /** Extra multiplier per full-attempt number (1-based). */
  drift?: Record<number, number>;
  /** Stall (never finish unless aborted) on these encode calls (1-based, all purposes). */
  stallOn?: number[];
  /** Abort via this controller halfway through this encode call (1-based). */
  abortOn?: { call: number; controller: AbortController };
  /** Throw on this encode call. */
  failOn?: { call: number; error: Error };
  /** Report videoBytes/audioBytes like the ffmpeg engine does. */
  splitBytes?: boolean;
}

export function testCaps(over: Partial<EngineCapabilities> = {}): EngineCapabilities {
  return {
    id: 'ffmpeg',
    version: 'test',
    encoderName: { h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9' },
    videoCodecs: ['h264', 'hevc', 'av1', 'vp9'],
    audioCodecs: ['aac', 'opus'],
    containers: ['mp4', 'webm'],
    twoPass: true,
    initialMargin: 0.02,
    rateCalibration: 'auto',
    audioCopyWithTrim: true,
    maxEncodeShortSide: {},
    canEncode: () => true,
    ...over,
  };
}

export const webCaps = (over: Partial<EngineCapabilities> = {}) =>
  testCaps({ id: 'web', encoderName: { h264: 'avc1', av1: 'av01', vp9: 'vp09' }, videoCodecs: ['h264', 'av1', 'vp9'], twoPass: false, initialMargin: 0.04, rateCalibration: 'always', audioCopyWithTrim: false, ...over });

export function makeProbe(p: { width?: number; height?: number; fps?: number; durationSec?: number; sizeBytes?: number; rotation?: 0 | 90 | 180 | 270; codec?: string; audio?: Probe['audio']; container?: string; videoBitrate?: number; hdr?: boolean } = {}): Probe {
  const w = p.width ?? 1920;
  const h = p.height ?? 1080;
  const rot = p.rotation ?? 0;
  const swap = rot === 90 || rot === 270;
  const probe: Probe = {
    container: p.container ?? 'mp4',
    sizeBytes: p.sizeBytes ?? 2000 * MB,
    durationSec: p.durationSec ?? 60,
    video: {
      codec: p.codec ?? 'h264',
      decodable: true,
      codedWidth: w,
      codedHeight: h,
      displayWidth: swap ? h : w,
      displayHeight: swap ? w : h,
      rotation: rot,
      fps: p.fps ?? 30,
      hdr: p.hdr ?? false,
      ...(p.videoBitrate ? { bitrate: p.videoBitrate } : {}),
    },
    audio: p.audio === undefined ? { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 128_000, decodable: true } : p.audio,
  };
  return probe;
}

export type FakeOut = { id: number; bytes: number };

export class FakeEngine implements Engine<string, FakeOut> {
  readonly id = 'ffmpeg' as const;
  calls: EncodePlan<string>[] = [];
  committed: FakeOut[] = [];
  discarded: number[] = [];
  live = new Set<number>();
  passed = 0;
  private n = 0;
  private id2 = 1;
  constructor(
    private probeValue: Probe,
    private model: RateModel = {},
    private caps: EngineCapabilities = testCaps(),
  ) {}
  async capabilities() {
    return this.caps;
  }
  async probe() {
    return this.probeValue;
  }
  async encode(plan: EncodePlan<string>, opts: { signal: AbortSignalLike; onProgress?: (p: { fraction: number; encodedSec: number }) => void }): Promise<EncodeResult<FakeOut>> {
    this.n++;
    const call = this.n;
    this.calls.push(plan);
    if (this.model.failOn?.call === call) throw this.model.failOn.error;
    const D = plan.trim ? plan.trim.endSec - plan.trim.startSec : this.probeValue.durationSec;
    const aborted = () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return e;
    };
    if (this.model.stallOn?.includes(call)) {
      opts.onProgress?.({ fraction: 0.1, encodedSec: D * 0.1 });
      await new Promise<void>((_, reject) => opts.signal.addEventListener('abort', () => reject(aborted()), { once: true }));
    }
    const full = this.calls.filter((c) => c.purpose !== 'calibration').length;
    const drift = plan.purpose === 'calibration' ? 1 : (this.model.drift?.[full] ?? 1);
    const v = plan.video;
    const floor = (this.model.floorBpp ?? 0) * v.width * v.height * v.fps;
    const actual = Math.max(floor, v.bitrate * (this.model.ratio ?? 1) * drift);
    const videoBytes = Math.round((actual * D) / 8);
    const audioBytes = plan.audio.mode === 'none' ? 0 : Math.round(((plan.audio.bitrate ?? 0) * D) / 8);
    const oh = overheadBytes(plan.container, D, v.fps, plan.audio.mode === 'none' ? null : { codec: plan.audio.codec!, sampleRate: plan.audio.sampleRate! });
    const bytes = videoBytes + audioBytes + Math.round(oh * 0.9);
    for (const f of [0.25, 0.5, 0.75, 1]) {
      if (this.model.abortOn?.call === call && f === 0.5) this.model.abortOn.controller.abort();
      if (opts.signal.aborted) throw aborted();
      opts.onProgress?.({ fraction: f, encodedSec: D * f });
      await Promise.resolve();
    }
    const id = this.id2++;
    this.live.add(id);
    return {
      output: { id, bytes },
      bytes,
      durationSec: D,
      encoder: 'fake264',
      ...(this.model.splitBytes ? { videoBytes, audioBytes } : {}),
    };
  }
  async frames(_src: string | FakeOut, times: number[], evalShortSide: number): Promise<LumaFrame[]> {
    const h = Math.min(evalShortSide, 36);
    const w = Math.round((h * 16) / 9 / 2) * 2;
    return times.map(() => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const g = (i * 37) % 251;
        data[i * 4] = g;
        data[i * 4 + 1] = g;
        data[i * 4 + 2] = g;
        data[i * 4 + 3] = 255;
      }
      return { width: w, height: h, data };
    });
  }
  async passThrough(): Promise<FakeOut> {
    this.passed++;
    return { id: 0, bytes: this.probeValue.sizeBytes };
  }
  async commit(o: FakeOut): Promise<FakeOut> {
    this.committed.push(o);
    return o;
  }
  async discard(o: FakeOut): Promise<void> {
    this.discarded.push(o.id);
    this.live.delete(o.id);
  }
}

export const CODECS: VideoCodecId[] = ['h264', 'hevc', 'av1', 'vp9'];

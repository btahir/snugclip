// A deterministic fake Engine that simulates real encoder behaviour: a bitrate ratio
// (overshoot/undershoot), an encoder floor, per-attempt drift, and slow encodes on an
// injected clock. Used by the fit-loop golden tests.
import type { Capabilities, EncodeResult, EncodeSpec, Engine, Probe, QualityMetrics } from '../src/index.js';
import { overheadBytes } from '../src/index.js';

export interface FakeBehaviour {
  /** actual = requested × ratio (before the floor). */
  ratio?: number;
  /** Encoder floor in bits per pixel per frame: actual ≥ floorBpp × w × h × fps. */
  floorBpp?: number;
  /** Multiplicative drift per attempt index (1-based), e.g. {1: 1.2} = first encode 20% heavier. */
  drift?: Record<number, number>;
  /** Encoded ms per second of media. */
  msPerSec?: number;
  rateControl?: Capabilities['rateControl'];
  video?: Capabilities['video'];
  audio?: Capabilities['audio'];
  /** Throw this on the given encode call (1-based). */
  failOn?: { call: number; error: Error };
  /** Abort via this controller during the given call. */
  abortOn?: { call: number; controller: AbortController };
  reportVideoBytes?: boolean;
}

export class FakeClock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export function makeProbe(p: Partial<Probe> & { width?: number; height?: number; fps?: number; audio?: Probe['audio'] | null } = {}): Probe {
  const width = p.width ?? 1920;
  const height = p.height ?? 1080;
  const fps = p.fps ?? 30;
  const durationSec = p.durationSec ?? 60;
  return {
    container: p.container ?? 'mp4',
    sizeBytes: p.sizeBytes ?? 100_000_000,
    durationSec,
    bitrate: p.bitrate ?? null,
    video: p.video ?? {
      codec: 'h264',
      codedWidth: width,
      codedHeight: height,
      rotation: 0,
      width,
      height,
      fps,
      bitrate: null,
      frameCount: Math.round(durationSec * fps),
      hdr: false,
      pixelFormat: 'yuv420p',
    },
    audio: p.audio === undefined ? { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 192_000 } : p.audio,
  };
}

export class FakeEngine implements Engine<string, { id: number; bytes: number }> {
  readonly name = 'fake';
  readonly version = '1.0.0';
  calls: EncodeSpec[] = [];
  discarded: number[] = [];
  live = new Set<number>();
  private next = 1;
  private encodeCalls = 0;
  constructor(
    private probeValue: Probe,
    private b: FakeBehaviour = {},
    private clock?: FakeClock,
  ) {}
  async probe(): Promise<Probe> {
    return this.probeValue;
  }
  async capabilities(): Promise<Capabilities> {
    return {
      video: this.b.video ?? ['h264', 'hevc', 'av1', 'vp9'],
      audio: this.b.audio ?? ['aac', 'opus'],
      audioCopy: ['aac', 'opus'],
      rateControl: this.b.rateControl ?? 'two-pass',
    };
  }
  async encode(_input: string, spec: EncodeSpec, opts: { signal?: AbortSignal; onProgress?: (f: number) => void } = {}): Promise<EncodeResult<{ id: number; bytes: number }>> {
    this.encodeCalls++;
    this.calls.push(spec);
    const call = this.encodeCalls;
    if (this.b.failOn?.call === call) throw this.b.failOn.error;
    const v = spec.video!;
    const dur = spec.trim ? spec.trim.end - spec.trim.start : this.probeValue.durationSec;
    const fullAttempt = this.calls.filter((c) => !c.sample).length;
    const drift = spec.sample ? 1 : (this.b.drift?.[fullAttempt] ?? 1);
    const floor = (this.b.floorBpp ?? 0) * v.width * v.height * v.fps;
    const actual = Math.max(floor, v.bitrate * (this.b.ratio ?? 1) * drift);
    const videoBytes = Math.round((actual * dur) / 8);
    const audioBytes = spec.audio ? Math.round((spec.audio.bitrate * dur) / 8) : 0;
    const oh = overheadBytes(spec.container, dur, v.fps, spec.audio ? { sampleRate: spec.audio.sampleRate, codec: spec.audio.codec } : null);
    const bytes = videoBytes + audioBytes + oh;
    for (const f of [0.25, 0.5, 0.75, 1]) {
      this.clock?.advance(((this.b.msPerSec ?? 100) * dur) / 4);
      if (this.b.abortOn?.call === call && f === 0.5) this.b.abortOn.controller.abort();
      if (opts.signal?.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }
      opts.onProgress?.(f);
    }
    const id = this.next++;
    this.live.add(id);
    const res: EncodeResult<{ id: number; bytes: number }> = { output: { id, bytes }, bytes, encoder: 'fake264' };
    if (this.b.reportVideoBytes) res.videoBytes = videoBytes;
    return res;
  }
  async discard(o: { id: number; bytes: number }) {
    this.discarded.push(o.id);
    this.live.delete(o.id);
  }
  async measureQuality(): Promise<QualityMetrics> {
    return { ssimMean: 0.962, ssimMin: 0.941, psnrMean: 38.2, frames: 10, width: 1280, height: 720 };
  }
}

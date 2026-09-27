// Safari's VideoEncoder can stall in latencyMode 'quality': it buffers frames and flush() never
// resolves (PLAN §8.3). Probe instead of sniffing the UA: encode 30 tiny frames in 'quality'
// mode and flush with a 2 s timeout. A timeout means every encode uses the manual pipeline with
// latencyMode 'realtime'.

export type LatencyMode = 'quality' | 'realtime';

export interface TimeoutTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const hostTimers: TimeoutTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type RaceResult<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' } | { ok: false; reason: 'error'; error: unknown };

/** Settles with the promise's outcome or 'timeout' after `ms`, whichever comes first. Never rejects. */
export function raceTimeout<T>(p: Promise<T>, ms: number, timers: TimeoutTimers = hostTimers): Promise<RaceResult<T>> {
  return new Promise((resolve) => {
    let done = false;
    const h = timers.setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, reason: 'timeout' });
    }, ms);
    p.then(
      (value) => {
        if (done) return;
        done = true;
        timers.clearTimeout(h);
        resolve({ ok: true, value });
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        timers.clearTimeout(h);
        resolve({ ok: false, reason: 'error', error });
      },
    );
  });
}

/** Only a timeout proves the stall; an error (unsupported config etc.) says nothing about it. */
export function latencyFromProbe(r: RaceResult<unknown>): LatencyMode {
  return !r.ok && r.reason === 'timeout' ? 'realtime' : 'quality';
}

export const PROBE_SIZE = 128;
export const PROBE_FRAMES = 30;
export const PROBE_TIMEOUT_MS = 2000;

/** A varying I420 test frame (a moving gradient, so the encoder has real work). */
export function probeFrameI420(i: number, size: number = PROBE_SIZE): Uint8Array {
  const y = size * size;
  const buf = new Uint8Array(y + 2 * (y / 4));
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) buf[r * size + c] = (r + c + i * 7) & 0xff;
  buf.fill(128, y);
  return buf;
}

const PROBE_CODECS = ['avc1.42001f', 'vp09.00.10.08', 'av01.0.04M.08'];

/** Runs the probe with raw WebCodecs (worker-safe). Returns 'quality' when WebCodecs is missing. */
export async function probeEncoderLatency(timers: TimeoutTimers = hostTimers): Promise<LatencyMode> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return 'quality';
  let config: VideoEncoderConfig | null = null;
  for (const codec of PROBE_CODECS) {
    const c: VideoEncoderConfig = { codec, width: PROBE_SIZE, height: PROBE_SIZE, bitrate: 300_000, framerate: 30, latencyMode: 'quality' };
    try {
      const s = await VideoEncoder.isConfigSupported(c);
      if (s.supported) {
        config = c;
        break;
      }
    } catch {
      /* try the next codec */
    }
  }
  if (!config) return 'quality';
  let encoder: VideoEncoder | null = null;
  try {
    encoder = new VideoEncoder({ output: () => {}, error: () => {} });
    encoder.configure(config);
    for (let i = 0; i < PROBE_FRAMES; i++) {
      const frame = new VideoFrame(probeFrameI420(i), {
        format: 'I420',
        codedWidth: PROBE_SIZE,
        codedHeight: PROBE_SIZE,
        timestamp: Math.round((i * 1e6) / 30),
        duration: Math.round(1e6 / 30),
      });
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }
    return latencyFromProbe(await raceTimeout(encoder.flush(), PROBE_TIMEOUT_MS, timers));
  } catch {
    return 'quality';
  } finally {
    try {
      encoder?.close();
    } catch {
      /* already closed */
    }
  }
}

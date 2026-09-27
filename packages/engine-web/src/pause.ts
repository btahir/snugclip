// Pause/resume for long encodes (BRIEF MVP §4). The app owns the gate; the engine awaits it
// between chunks: between `Conversion.execute({ until })` steps (2 s of output each) and, with
// `onPause`, mid-step through mediabunny's `pauseSignal`; in the manual pipeline, between frames.
import type { AbortSignalLike } from '@snugclip/core';
import { SnugclipError } from '@snugclip/core';

export interface PauseGate {
  /** Resolves when encoding may continue (immediately when not paused). */
  wait(): Promise<void>;
  /**
   * Optional: subscribe to pause presses so the engine can stop mid-step instead of at the next
   * step boundary. Returns an unsubscribe function.
   */
  onPause?(listener: () => void): () => void;
}

export interface PauseController {
  readonly gate: PauseGate;
  readonly paused: boolean;
  pause(): void;
  resume(): void;
}

/** A ready-made gate for the app's worker: call pause()/resume() from message handlers. */
export function createPauseController(): PauseController {
  let paused = false;
  let waiters: Array<() => void> = [];
  const listeners = new Set<() => void>();
  const gate: PauseGate = {
    wait: () => (paused ? new Promise<void>((r) => waiters.push(r)) : Promise.resolve()),
    onPause(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    gate,
    get paused() {
      return paused;
    },
    pause() {
      if (paused) return;
      paused = true;
      for (const l of [...listeners]) l();
    },
    resume() {
      if (!paused) return;
      paused = false;
      const w = waiters;
      waiters = [];
      for (const r of w) r();
    },
  };
}

export interface IntervalTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const hostTimers: IntervalTimers = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

/** Rejects with E_CANCELLED when `signal` aborts; otherwise settles like `p`. */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignalLike | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new SnugclipError('E_CANCELLED', 'Cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SnugclipError('E_CANCELLED', 'Cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Waits on the gate. While held, calls `heartbeat` every `heartbeatMs` so the core's stall
 * watchdog (which re-arms on every progress callback) doesn't mistake a user pause for a stall.
 * Cancelling while paused rejects with E_CANCELLED.
 */
export async function holdWhilePaused(
  gate: PauseGate | undefined,
  opts: { signal?: AbortSignalLike; heartbeat?: () => void; heartbeatMs?: number; timers?: IntervalTimers } = {},
): Promise<void> {
  if (!gate) return;
  const waiting = gate.wait();
  let settled = false;
  void waiting.then(
    () => (settled = true),
    () => (settled = true),
  );
  await Promise.resolve(); // an open gate resolves within a microtask: skip the timer entirely
  if (settled) return raceAbort(waiting, opts.signal);
  const timers = opts.timers ?? hostTimers;
  const handle = opts.heartbeat ? timers.setInterval(opts.heartbeat, opts.heartbeatMs ?? 5000) : undefined;
  try {
    await raceAbort(waiting, opts.signal);
  } finally {
    if (handle !== undefined) timers.clearInterval(handle);
  }
}

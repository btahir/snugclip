// Main-thread side of the compression worker. One worker for the page's lifetime.
import type { FitProgress, Options, Probe, Report, Target } from '@snugclip/core';
import type { FromWorker, ToWorker, WireCaps, WireError, WorkerEnv } from '@/workers/protocol';

export interface InitResult {
  caps: WireCaps | null;
  supported: boolean;
  reason?: string;
  engine: string;
  env?: WorkerEnv;
}

/** Thrown for requests the worker couldn't answer (it failed to load, crashed, or threw). */
export class WorkerFailure extends Error {
  constructor(readonly error: WireError) {
    super(error.message);
    this.name = 'WorkerFailure';
  }
}

export interface RunHandlers {
  onProgress?: (p: FitProgress) => void;
  onStall?: () => void;
}

export interface RunHandle {
  rid: number;
  done: Promise<{ report: Report; output: Blob | null }>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

type Pending = (msg: FromWorker) => void;

export class WorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  /** Set once the worker failed to load or crashed; every request then fails at once. */
  private dead: WireError | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/compress.worker.ts', import.meta.url), { type: 'module', name: 'snugclip-compress' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      this.pending.get(ev.data.rid)?.(ev.data);
    };
    // A module worker that can't load (no module-worker support, a blocked script, a syntax
    // error in an old engine) or dies fires `error` on the page side and nothing else. Without
    // this, init and every queued item would wait forever.
    this.worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      this.failAll({ code: 'E_WORKER', message: ev.message || 'The compression worker stopped.' });
    };
    this.worker.onmessageerror = () => {
      this.failAll({ code: 'E_WORKER', message: "The compression worker's reply couldn't be read." });
    };
  }

  private failAll(error: WireError) {
    this.dead = error;
    for (const [rid, handler] of [...this.pending]) handler({ type: 'failed', rid, error });
    this.pending.clear();
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  /** Waits for the reply of `type` to request `rid`; rejects with WorkerFailure if the worker fails it. */
  private once<T extends FromWorker['type']>(rid: number, type: T): Promise<Extract<FromWorker, { type: T }>> {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new WorkerFailure(this.dead));
      this.pending.set(rid, (m) => {
        if (m.type === type) {
          this.pending.delete(rid);
          resolve(m as Extract<FromWorker, { type: T }>);
        } else if (m.type === 'failed') {
          this.pending.delete(rid);
          reject(new WorkerFailure(m.error));
        }
      });
    });
  }

  async init(): Promise<InitResult> {
    const rid = this.nextId++;
    const p = this.once(rid, 'init');
    this.send({ type: 'init', rid });
    const { caps, supported, reason, engine, env } = await p;
    return { caps, supported, engine, ...(reason ? { reason } : {}), ...(env ? { env } : {}) };
  }

  async probe(file: Blob): Promise<{ probe?: Probe; error?: WireError }> {
    const rid = this.nextId++;
    const p = this.once(rid, 'probe');
    this.send({ type: 'probe', rid, file });
    try {
      const r = await p;
      return { ...(r.probe ? { probe: r.probe } : {}), ...(r.error ? { error: r.error } : {}) };
    } catch (e) {
      return { error: e instanceof WorkerFailure ? e.error : { code: 'E_WORKER', message: String(e) } };
    }
  }

  async thumbs(file: Blob, times: number[], height: number): Promise<(Blob | null)[]> {
    const rid = this.nextId++;
    const p = this.once(rid, 'thumbs');
    this.send({ type: 'thumbs', rid, file, times, height });
    try {
      return (await p).blobs;
    } catch {
      return times.map(() => null);
    }
  }

  /** `done` rejects with WorkerFailure when the worker can't finish the run at all. */
  run(file: Blob, name: string, target: Target, options: Partial<Options>, probe: Probe | undefined, h: RunHandlers): RunHandle {
    const rid = this.nextId++;
    const done = new Promise<{ report: Report; output: Blob | null }>((resolve, reject) => {
      if (this.dead) return reject(new WorkerFailure(this.dead));
      this.pending.set(rid, (m) => {
        if (m.type === 'progress') h.onProgress?.(m.progress);
        else if (m.type === 'stall') h.onStall?.();
        else if (m.type === 'done') {
          this.pending.delete(rid);
          resolve({ report: m.report, output: m.output });
        } else if (m.type === 'failed') {
          this.pending.delete(rid);
          reject(new WorkerFailure(m.error));
        }
      });
    });
    this.send({ type: 'run', rid, file, name, target, options, ...(probe ? { probe } : {}) });
    return {
      rid,
      done,
      cancel: () => this.send({ type: 'cancel', rid }),
      pause: () => this.send({ type: 'pause', rid }),
      resume: () => this.send({ type: 'resume', rid }),
    };
  }

  terminate() {
    this.worker.terminate();
  }
}

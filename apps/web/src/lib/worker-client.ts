// Main-thread side of the compression worker. One worker for the page's lifetime.
import type { FitProgress, Options, Probe, Report, Target } from '@snugclip/core';
import type { FromWorker, ToWorker, WireCaps, WireError } from '@/workers/protocol';

export interface InitResult {
  caps: WireCaps | null;
  supported: boolean;
  reason?: string;
  engine: string;
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

  constructor() {
    this.worker = new Worker(new URL('../workers/compress.worker.ts', import.meta.url), { type: 'module', name: 'snugclip-compress' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      this.pending.get(ev.data.rid)?.(ev.data);
    };
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private once<T extends FromWorker['type']>(rid: number, type: T): Promise<Extract<FromWorker, { type: T }>> {
    return new Promise((resolve) => {
      this.pending.set(rid, (m) => {
        if (m.type === type) {
          this.pending.delete(rid);
          resolve(m as Extract<FromWorker, { type: T }>);
        }
      });
    });
  }

  async init(): Promise<InitResult> {
    const rid = this.nextId++;
    const p = this.once(rid, 'init');
    this.send({ type: 'init', rid });
    const { caps, supported, reason, engine } = await p;
    return { caps, supported, engine, ...(reason ? { reason } : {}) };
  }

  async probe(file: Blob): Promise<{ probe?: Probe; error?: WireError }> {
    const rid = this.nextId++;
    const p = this.once(rid, 'probe');
    this.send({ type: 'probe', rid, file });
    const r = await p;
    return { ...(r.probe ? { probe: r.probe } : {}), ...(r.error ? { error: r.error } : {}) };
  }

  async thumbs(file: Blob, times: number[], height: number): Promise<(Blob | null)[]> {
    const rid = this.nextId++;
    const p = this.once(rid, 'thumbs');
    this.send({ type: 'thumbs', rid, file, times, height });
    return (await p).blobs;
  }

  run(file: Blob, name: string, target: Target, options: Partial<Options>, probe: Probe | undefined, h: RunHandlers): RunHandle {
    const rid = this.nextId++;
    const done = new Promise<{ report: Report; output: Blob | null }>((resolve) => {
      this.pending.set(rid, (m) => {
        if (m.type === 'progress') h.onProgress?.(m.progress);
        else if (m.type === 'stall') h.onStall?.();
        else if (m.type === 'done') {
          this.pending.delete(rid);
          resolve({ report: m.report, output: m.output });
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

// Browser-compatibility fallbacks that can be checked without a browser: the worker client never
// leaves the page waiting when the worker can't load or crashes, and audio-only failures are told
// apart from picture failures (so the UI offers "Try without sound").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAudioError } from '@/lib/tool-model';
import { WorkerClient, WorkerFailure } from '@/lib/worker-client';

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: unknown[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  terminate() {}
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  crash(message: string) {
    this.onerror?.({ message, preventDefault() {} } as unknown as ErrorEvent);
  }
}

describe('WorkerClient fallbacks', () => {
  beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
  afterEach(() => vi.unstubAllGlobals());

  it('rejects init when the module worker fails to load', async () => {
    const c = new WorkerClient();
    const p = c.init();
    FakeWorker.last!.crash('SyntaxError: import declarations may only appear at top level');
    await expect(p).rejects.toBeInstanceOf(WorkerFailure);
  });

  it('passes the feature-detected env through init', async () => {
    const c = new WorkerClient();
    const p = c.init();
    FakeWorker.last!.reply({ type: 'init', rid: 1, caps: null, supported: true, engine: 'x', env: { audioDecoder: false } });
    await expect(p).resolves.toMatchObject({ supported: true, env: { audioDecoder: false } });
  });

  it('fails a running encode, probes and thumbnails when the worker dies, and later requests at once', async () => {
    const c = new WorkerClient();
    const run = c.run(new Blob(), 'a.mp4', { bytes: 1_000_000 } as never, {}, undefined, {});
    const probe = c.probe(new Blob());
    const thumbs = c.thumbs(new Blob(), [0, 1], 90);
    FakeWorker.last!.crash('');
    await expect(run.done).rejects.toMatchObject({ error: { code: 'E_WORKER' } });
    await expect(probe).resolves.toMatchObject({ error: { code: 'E_WORKER' } });
    await expect(thumbs).resolves.toEqual([null, null]);
    await expect(c.init()).rejects.toBeInstanceOf(WorkerFailure);
  });

  it("rejects a run the worker reports as failed, without touching other requests", async () => {
    const c = new WorkerClient();
    const run = c.run(new Blob(), 'a.mp4', { bytes: 1 } as never, {}, undefined, {});
    const probe = c.probe(new Blob());
    FakeWorker.last!.reply({ type: 'failed', rid: 1, error: { code: 'E_INTERNAL', message: 'DataCloneError' } });
    await expect(run.done).rejects.toMatchObject({ error: { message: 'DataCloneError' } });
    FakeWorker.last!.reply({ type: 'probe', rid: 2, error: { code: 'E_UNSUPPORTED', message: 'nope' } });
    await expect(probe).resolves.toMatchObject({ error: { code: 'E_UNSUPPORTED' } });
  });
});

describe('isAudioError', () => {
  it('flags engine errors about the sound', () => {
    expect(isAudioError({ code: 'E_UNSUPPORTED', message: "This browser can't decode this file's audio." })).toBe(true);
    expect(isAudioError({ code: 'E_UNSUPPORTED_ENCODER', message: "This browser can't encode the audio." })).toBe(true);
    expect(isAudioError({ code: 'E_UNSUPPORTED_ENCODER', message: "The AAC encoder couldn't be loaded: HTTP 404" })).toBe(true);
  });
  it('leaves picture and other errors alone', () => {
    expect(isAudioError({ code: 'E_UNSUPPORTED', message: "This browser can't decode this video." })).toBe(false);
    expect(isAudioError({ code: 'E_ENCODE', message: 'audio encoder error' })).toBe(false);
    expect(isAudioError(undefined)).toBe(false);
  });
});

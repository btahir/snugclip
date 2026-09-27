/// <reference lib="webworker" />
// The compression worker: runs core `runFit()` with the web Engine off the main thread so the
// page stays responsive. One compression at a time (the page queues them); probes and
// thumbnails can run alongside.
import { TUNING, isSnugclipError, runFit, type EngineCapabilities } from '@snugclip/core';
import { CanvasSink, ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { loadEngine, type PausableEngine } from './engine';
import type { FromWorker, ToWorker, WireCaps, WireError } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let enginePromise: Promise<{ engine: PausableEngine; name: string }> | null = null;
const getEngine = () => (enginePromise ??= loadEngine());
const runs = new Map<number, AbortController>();

function post(msg: FromWorker) {
  self.postMessage(msg);
}

function toWire(e: unknown): WireError {
  if (isSnugclipError(e)) return { code: e.code, message: e.message, details: e.details };
  const err = e as { name?: string; message?: string };
  return { code: err?.name === 'AbortError' ? 'E_CANCELLED' : 'E_INTERNAL', message: err?.message ?? String(e) };
}

function wireCaps(c: EngineCapabilities): WireCaps {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (typeof v !== 'function') out[k] = v;
  const wire = out as WireCaps;
  if (c.canEncodeAudio) {
    const ok: string[] = [];
    for (const codec of ['aac', 'opus'] as const)
      for (const kbps of TUNING.audioLadder[codec])
        for (const ch of [1, 2] as const)
          for (const sr of [44100, 48000])
            if (c.canEncodeAudio(codec, kbps * 1000, ch, sr)) ok.push(`${codec}:${kbps * 1000}:${ch}:${sr}`);
    wire.audioOk = ok;
  }
  return wire;
}

async function thumbs(file: Blob, times: number[], height: number): Promise<(Blob | null)[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return times.map(() => null);
    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const width = Math.max(2, Math.round((dw / dh) * height));
    const sink = new CanvasSink(track, { width, height, fit: 'fill' });
    const first = await track.getFirstTimestamp().catch(() => 0);
    const out: (Blob | null)[] = [];
    for await (const wc of sink.canvasesAtTimestamps(times.map((t) => Math.max(first, t)))) {
      if (!wc) {
        out.push(null);
        continue;
      }
      const c = wc.canvas as OffscreenCanvas;
      out.push(await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 }));
    }
    return out;
  } finally {
    input.dispose();
  }
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      // Feature detection in the worker's own realm: a browser can expose WebCodecs on the page
      // but not in workers, and Safari before 26 has video WebCodecs without AudioDecoder.
      const env = { audioDecoder: typeof AudioDecoder !== 'undefined' };
      const supported = typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
      if (!supported) {
        post({ type: 'init', rid: msg.rid, caps: null, supported: false, reason: 'no-webcodecs', engine: 'none', env });
        return;
      }
      try {
        const { engine, name } = await getEngine();
        const caps = await engine.capabilities();
        const ok = caps.videoCodecs.includes('h264') || caps.videoCodecs.includes('vp9');
        post({ type: 'init', rid: msg.rid, caps: wireCaps(caps), supported: ok, ...(ok ? {} : { reason: 'no-encoder' }), engine: `${name} ${caps.version} · ${engine.latencyMode} latency${engine.aacPolyfilled ? ' · AAC from /vendor' : ''}`, env });
      } catch (e) {
        console.error('snugclip: engine init failed', e);
        post({ type: 'init', rid: msg.rid, caps: null, supported: false, reason: toWire(e).message, engine: 'none', env });
      }
      return;
    }
    case 'probe': {
      try {
        const { engine } = await getEngine();
        post({ type: 'probe', rid: msg.rid, probe: await engine.probe(msg.file) });
      } catch (e) {
        post({ type: 'probe', rid: msg.rid, error: toWire(e) });
      }
      return;
    }
    case 'thumbs': {
      try {
        post({ type: 'thumbs', rid: msg.rid, blobs: await thumbs(msg.file, msg.times, msg.height) });
      } catch (e) {
        post({ type: 'thumbs', rid: msg.rid, blobs: [], error: toWire(e) });
      }
      return;
    }
    case 'run': {
      const ctl = new AbortController();
      runs.set(msg.rid, ctl);
      try {
        const { engine } = await getEngine();
        let lastPost = 0;
        const report = await runFit(engine, msg.file, msg.target, msg.options, {
          now: () => Date.now(),
          signal: ctl.signal,
          inputName: msg.name,
          ...(msg.probe ? { probe: msg.probe } : {}),
          stallMs: TUNING.stallMs.web,
          timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as number) },
          onProgress: (p) => {
            const t = Date.now();
            if (t - lastPost < 100 && p.phase !== 'done') return; // ≤ 10 messages/s
            lastPost = t;
            post({ type: 'progress', rid: msg.rid, progress: p });
          },
        });
        const { outputRef, ...plain } = report;
        post({ type: 'done', rid: msg.rid, report: plain, output: outputRef ?? null });
      } catch (e) {
        // runFit reports encode errors in its Report; a throw here is unexpected (engine load,
        // a structured-clone failure). Tell the page so the item doesn't wait forever.
        console.error('snugclip: run failed', e);
        post({ type: 'failed', rid: msg.rid, error: toWire(e) });
      } finally {
        runs.delete(msg.rid);
      }
      return;
    }
    case 'cancel': {
      runs.get(msg.rid)?.abort();
      const { engine } = await getEngine();
      engine.resume?.();
      return;
    }
    case 'pause': {
      const { engine } = await getEngine();
      engine.pause?.();
      return;
    }
    case 'resume': {
      const { engine } = await getEngine();
      engine.resume?.();
      return;
    }
  }
};

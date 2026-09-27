import { runFit, resolveTarget, TUNING } from '@snugclip/core';
import { createWebEngine } from '@snugclip/engine-web';
const warnings: unknown[] = [];
const engine = createWebEngine({ aacEncoderUrl: '/vendor/aac-encoder-1.60.0.mjs', onWarning: (w) => warnings.push(w) });
self.onmessage = async (ev: MessageEvent) => {
  const { id, cmd } = ev.data;
  const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage({ ...m, id });
  try {
    if (cmd === 'caps') {
      const caps = await engine.capabilities();
      post({ caps });
      return;
    }
    const { name, blob, bytes, options } = ev.data;
    warnings.length = 0;
    const t0 = performance.now();
    const r = await runFit(engine, blob, resolveTarget({ size: `${bytes}B` }), options, {
      now: () => Date.now(), signal: new AbortController().signal, inputName: name, stallMs: TUNING.stallMs.web,
      timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number) },
    });
    const { outputRef, ...report } = r as typeof r & { outputRef?: Blob };
    post({ ms: Math.round(performance.now() - t0), report, output: outputRef ?? null, lastAudioEncoder: engine.lastAudioEncoder, warnings: [...warnings] });
  } catch (e) {
    post({ error: { code: (e as any)?.code ?? 'THROW', message: String((e as any)?.message ?? e) } });
  }
};

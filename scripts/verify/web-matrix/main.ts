// Verifier harness page (ACCEPTANCE B1/B2/B3): runs core runFit() with engine-web in a worker,
// exactly like apps/web's compress worker, and uploads each output to the harness server so the
// node side can check it with ffprobe/ffmpeg. Never open this in the Claude in-app browser.
import { detectWebSupport } from '@snugclip/engine-web';
const w = new Worker('./worker.js', { type: 'module' });
let seq = 0;
const pending = new Map<number, (v: any) => void>();
w.onmessage = (e) => { const r = pending.get(e.data.id); pending.delete(e.data.id); r?.(e.data); };
w.onerror = (e) => { for (const r of pending.values()) r({ error: { code: 'WORKER', message: e.message } }); pending.clear(); };
const ask = (msg: Record<string, unknown>) => new Promise<any>((resolve) => { const id = ++seq; pending.set(id, resolve); w.postMessage({ ...msg, id }); });
(window as any).snug = {
  support: () => detectWebSupport(),
  caps: () => ask({ cmd: 'caps' }),
  run: async (key: string, name: string, bytes: number, options: Record<string, unknown> = {}) => {
    const blob = await (await fetch('/fx/' + name)).blob();
    const r = await ask({ cmd: 'run', name, bytes, options, blob });
    if (r.output) {
      await fetch('/upload/' + encodeURIComponent(key), { method: 'POST', body: r.output });
      r.uploaded = r.output.size;
      delete r.output;
    }
    return r;
  },
};
document.title = 'READY';

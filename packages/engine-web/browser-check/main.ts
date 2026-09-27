import { detectWebSupport } from '@snugclip/engine-web';
const w = new Worker('./worker.js', { type: 'module' });
const ask = (msg: unknown) => new Promise<any>((resolve) => { w.onmessage = (e) => resolve(e.data); w.onerror = (e) => resolve({ error: e.message }); w.postMessage(msg); });
(window as any).snug = {
  support: () => detectWebSupport(),
  caps: () => ask({ cmd: 'caps' }),
  run: async (name: string, size: string) => ask({ name, size, blob: await (await fetch('/fx/' + name)).blob() }),
};
document.title = 'READY';

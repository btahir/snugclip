import { audioEncoders } from './counter.js';
import { runFit, resolveTarget, TUNING } from '@snugclip/core';
import { createWebEngine } from '@snugclip/engine-web';
const warnings: unknown[] = [];
const engine = createWebEngine({ aacEncoderUrl: '/vendor/aac-encoder-1.60.0.mjs', onWarning: (w) => warnings.push(w) });
self.onmessage = async (ev: MessageEvent) => {
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m);
  if (ev.data.cmd === 'caps') {
    const caps = await engine.capabilities();
    post({ caps: { videoCodecs: caps.videoCodecs, audioCodecs: caps.audioCodecs }, audioEncodersCreated: audioEncoders.created, aacPolyfilled: engine.aacPolyfilled });
    return;
  }
  const { name, blob, size } = ev.data;
  const before = audioEncoders.created;
  const beforeCfg = audioEncoders.configs.length;
  const t0 = performance.now();
  const r = await runFit(engine, blob, resolveTarget({ size }), {}, {
    now: () => Date.now(), signal: new AbortController().signal, inputName: name, stallMs: TUNING.stallMs.web,
    timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number) },
  });
  const { outputRef, ...rep } = r;
  const reprobe = outputRef && r.status === 'fit' ? await engine.probe(outputRef as Blob) : null;
  post({
    name, size, ms: Math.round(performance.now() - t0), status: rep.status, bytes: rep.output?.bytes, target: rep.target.bytes,
    video: rep.output?.video, audio: rep.output?.audio, planAudio: rep.plan?.audio, attempts: rep.attempts.map((a) => ({ p: a.purpose, w: a.rung.width, h: a.rung.height, req: a.requestedVideoBitrate, bytes: a.bytes, fits: a.fits })),
    quality: rep.quality && { ssimMean: rep.quality.ssimMean, ssimMin: rep.quality.ssimMin }, error: rep.error, encoder: rep.engine.encoder,
    lastAudioEncoder: engine.lastAudioEncoder, aacPolyfilled: engine.aacPolyfilled,
    nativeAudioEncodersCreated: audioEncoders.created - before, nativeAudioConfigs: audioEncoders.configs.slice(beforeCfg),
    reprobe: reprobe && { durationSec: reprobe.durationSec, w: reprobe.video?.displayWidth, h: reprobe.video?.displayHeight, audio: reprobe.audio }, warnings,
  });
};

// @snugclip/engine-web: the Snugclip Engine for browsers (WebCodecs via mediabunny). Runs inside
// a dedicated module Web Worker or on the main thread. PLAN §4.9, §8.2–8.7.
export { createWebEngine } from './engine.js';
export type { WebEngine, WebEngineOptions } from './engine.js';
export { detectWebSupport, summarizeSupport } from './support.js';
export type { SupportEnv, WebSupport } from './support.js';
export { createPauseController, holdWhilePaused } from './pause.js';
export type { PauseController, PauseGate } from './pause.js';
export { cleanupOpfsOutputs } from './opfs.js';
export { ENGINE_VERSION, MEDIABUNNY_VERSION } from './capabilities.js';
export { probeBlob } from './probe.js';
export { decodeFrames, evalDims } from './frames.js';
export { loadAacEncoder, rewriteBareMediabunnyImport } from './aac-loader.js';
export { mapEngineError } from './errors-map.js';
export { aacNeedsWasm, makeCanEncodeAudio, type AacRouting } from './aac-routing.js';

// The Engine the worker runs: @snugclip/engine-web (WebCodecs via mediabunny), with the AAC
// encoder served unmodified from our own origin and a pause gate the page controls.
import { cleanupOpfsOutputs, createPauseController, createWebEngine, type WebEngine } from '@snugclip/engine-web';
import { AAC_ENCODER_URL } from '@/config/vendor.generated';

export type PausableEngine = WebEngine & { pause: () => void; resume: () => void };

export async function loadEngine(): Promise<{ engine: PausableEngine; name: string }> {
  await cleanupOpfsOutputs().catch(() => {});
  const ctl = createPauseController();
  const engine = createWebEngine({ aacEncoderUrl: AAC_ENCODER_URL, pause: ctl.gate }) as PausableEngine;
  engine.pause = () => ctl.pause();
  engine.resume = () => ctl.resume();
  return { engine, name: 'engine-web' };
}

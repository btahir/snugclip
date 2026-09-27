// Picks the Engine the worker runs. Prefers @snugclip/engine-web; falls back to the interim
// mediabunny engine in this app until engine-web exports `createWebEngine`.
import type { Engine } from '@snugclip/core';
import { AAC_ENCODER_URL } from '@/config/vendor.generated';
import { InterimWebEngine } from './interim-engine';

export type PausableEngine = Engine<Blob, Blob> & { pause?: () => void; resume?: () => void };

export async function loadEngine(): Promise<{ engine: PausableEngine; name: string }> {
  void AAC_ENCODER_URL;
  return { engine: new InterimWebEngine(), name: 'interim' };
}

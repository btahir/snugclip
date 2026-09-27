// Messages between the page and the compression worker. Everything is structured-cloneable
// (File/Blob are passed by reference, never copied).
import type { EngineCapabilities, FitProgress, Options, Probe, Report, Target } from '@snugclip/core';

/** Capabilities without the canEncode function (functions can't cross the worker boundary). */
export type WireCaps = Omit<EngineCapabilities, 'canEncode'>;

export type ToWorker =
  | { type: 'init'; rid: number }
  | { type: 'probe'; rid: number; file: Blob }
  | { type: 'thumbs'; rid: number; file: Blob; times: number[]; height: number }
  | { type: 'run'; rid: number; file: Blob; name: string; target: Target; options: Partial<Options>; probe?: Probe }
  | { type: 'cancel'; rid: number }
  | { type: 'pause'; rid: number }
  | { type: 'resume'; rid: number };

export interface WireError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type FromWorker =
  | { type: 'init'; rid: number; caps: WireCaps | null; supported: boolean; reason?: string; engine: string }
  | { type: 'probe'; rid: number; probe?: Probe; error?: WireError }
  | { type: 'thumbs'; rid: number; blobs: (Blob | null)[]; error?: WireError }
  | { type: 'progress'; rid: number; progress: FitProgress; encodedFraction?: number }
  | { type: 'stall'; rid: number }
  | { type: 'done'; rid: number; report: Report; output: Blob | null };

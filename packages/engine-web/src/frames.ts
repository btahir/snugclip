// Matched RGBA frames for the quality check (PLAN §5): the frame shown at each time, rotated to
// display orientation and scaled so its short side = evalShortSide. Source and output are scaled
// to the same short side, so the comparison includes any resolution loss (intended).
import type { AbortSignalLike, LumaFrame } from '@snugclip/core';
import { SnugclipError, throwIfAborted } from '@snugclip/core';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { WrappedCanvas } from 'mediabunny';

/** Canvas size for a display size scaled to short side `evalShortSide` (never below 2 px). */
export function evalDims(displayWidth: number, displayHeight: number, evalShortSide: number): { width: number; height: number } {
  const e = Math.max(2, Math.round(evalShortSide));
  if (!(displayWidth > 0 && displayHeight > 0)) return { width: e, height: e };
  if (displayWidth <= displayHeight) return { width: e, height: Math.max(2, Math.round((displayHeight * e) / displayWidth)) };
  return { width: Math.max(2, Math.round((displayWidth * e) / displayHeight)), height: e };
}

/** Times sorted ascending (the fast path for `canvasesAtTimestamps`) with each one's original index. */
export function sortedTimes(times: readonly number[]): Array<{ t: number; index: number }> {
  return times
    .map((t, index) => ({ t: Number.isFinite(t) && t > 0 ? t : 0, index }))
    .sort((a, b) => a.t - b.t || a.index - b.index);
}

interface Ctx2D {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
}
interface AnyCanvas {
  width: number;
  height: number;
  getContext(id: '2d'): unknown;
}

function readRgba(wc: WrappedCanvas): LumaFrame {
  const canvas = wc.canvas as unknown as AnyCanvas;
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new SnugclipError('E_ENCODE', 'No 2D canvas context for the quality check.');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Copy: the sink may reuse its canvas and the ImageData buffer is ours to keep anyway.
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** Decodes the frame at each time (last frame starting at or before t; the first frame for t before it). */
export async function decodeFrames(src: Blob, timesSec: readonly number[], evalShortSide: number, signal: AbortSignalLike): Promise<LumaFrame[]> {
  throwIfAborted(signal);
  if (timesSec.length === 0) return [];
  const input = new Input({ source: new BlobSource(src), formats: ALL_FORMATS });
  const onAbort = () => input.dispose();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new SnugclipError('E_UNSUPPORTED', 'No video track to compare.');
    const { width, height } = evalDims(await track.getDisplayWidth(), await track.getDisplayHeight(), evalShortSide);
    const sink = new CanvasSink(track, { width, height, fit: 'fill' });
    // Times before the first frame (t = 0 on a file whose first frame is at 0.033 s) get the first frame.
    const first = await track.getFirstTimestamp();
    const order = sortedTimes(timesSec).map((o) => ({ ...o, t: Math.max(o.t, first) }));
    const out: Array<LumaFrame | undefined> = Array.from({ length: timesSec.length });
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(order.map((o) => o.t))) {
      throwIfAborted(signal);
      const slot = order[i++];
      if (!slot) break;
      if (wc) out[slot.index] = readRgba(wc);
    }
    throwIfAborted(signal);
    const frames = out.filter((f): f is LumaFrame => f !== undefined);
    if (frames.length !== timesSec.length) throw new SnugclipError('E_ENCODE', `Decoded ${frames.length} of ${timesSec.length} frames for the quality check.`);
    return frames;
  } finally {
    signal.removeEventListener('abort', onAbort);
    input.dispose();
  }
}

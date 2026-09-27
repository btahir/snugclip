// Browser/mediabunny failures → SnugclipError codes the core and UI understand. Pure.
import type { AbortSignalLike } from '@snugclip/core';
import { isSnugclipError, SnugclipError } from '@snugclip/core';

function nameOf(e: unknown): string {
  return typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : '';
}

function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  return typeof e === 'string' ? e : 'Unknown error';
}

/**
 * Maps any error thrown while encoding/probing/decoding. An aborted signal always wins
 * (mediabunny may surface a cancel as a generic error or an InputDisposedError).
 */
export function mapEngineError(e: unknown, signal?: AbortSignalLike, phase: 'probe' | 'encode' | 'frames' = 'encode'): SnugclipError {
  if (isSnugclipError(e)) return e as SnugclipError;
  const name = nameOf(e);
  if (signal?.aborted || name === 'AbortError' || name === 'ConversionCanceledError') {
    return new SnugclipError('E_CANCELLED', 'Cancelled.', { cause: e });
  }
  if (name === 'QuotaExceededError') {
    return new SnugclipError('E_QUOTA', 'Not enough free storage in this browser for the output.', {
      hint: 'Free some disk space, trim the clip, or pick a smaller limit.',
      cause: e,
    });
  }
  if (name === 'UnsupportedInputFormatError') {
    return new SnugclipError('E_UNSUPPORTED', "This file's format can't be read in the browser.", {
      hint: 'Snugclip handles MP4, MOV, M4V, WebM and MKV. The CLI (ffmpeg) reads more formats.',
      cause: e,
    });
  }
  if (name === 'NotSupportedError') {
    return new SnugclipError('E_UNSUPPORTED_ENCODER', `This browser can't encode with these settings: ${messageOf(e)}`, { cause: e });
  }
  const msg = messageOf(e);
  if (phase === 'probe') return new SnugclipError('E_UNSUPPORTED', `Couldn't read this video: ${msg}`, { cause: e });
  return new SnugclipError('E_ENCODE', phase === 'frames' ? `Couldn't decode frames for the quality check: ${msg}` : `Encoding failed: ${msg}`, { cause: e });
}

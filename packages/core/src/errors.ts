// Typed errors shared by every engine and surface, plus the CLI's stable exit codes.

export type ErrorCode =
  | 'IMPOSSIBLE_TARGET'
  | 'UNSUPPORTED_INPUT'
  | 'UNSUPPORTED_BROWSER'
  | 'FFMPEG_MISSING'
  | 'ENCODER_MISSING'
  | 'ENCODE_FAILED'
  | 'COULD_NOT_FIT'
  | 'STALLED'
  | 'CANCELLED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_JOB_FILE'
  | 'IO_ERROR'
  | 'INTERNAL';

export class SnugclipError extends Error {
  readonly code: ErrorCode;
  /** Extra machine-readable data (e.g. `minimumBytes`, `hint`). */
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SnugclipError';
    this.code = code;
    this.details = details;
  }
}

export function isSnugclipError(e: unknown): e is SnugclipError {
  return e instanceof SnugclipError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'SnugclipError');
}

/** True for AbortSignal-driven cancellation from any source (DOMException or our own). */
export function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: string; code?: string };
  return err.name === 'AbortError' || err.code === 'CANCELLED';
}

/** Throws a cancellation error if the signal is aborted. */
export function throwIfAborted(signal: { readonly aborted: boolean } | undefined): void {
  if (signal?.aborted) throw new SnugclipError('CANCELLED', 'Cancelled.');
}

/** Stable CLI exit codes (documented in AGENTS.md). */
export const EXIT = {
  OK: 0,
  OTHER: 1,
  IMPOSSIBLE: 2,
  UNSUPPORTED: 3,
  FFMPEG_MISSING: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitCodeFor(code: ErrorCode | null | undefined): ExitCode {
  switch (code) {
    case null:
    case undefined:
      return EXIT.OK;
    case 'IMPOSSIBLE_TARGET':
      return EXIT.IMPOSSIBLE;
    case 'UNSUPPORTED_INPUT':
    case 'UNSUPPORTED_BROWSER':
      return EXIT.UNSUPPORTED;
    case 'FFMPEG_MISSING':
      return EXIT.FFMPEG_MISSING;
    default:
      return EXIT.OTHER;
  }
}

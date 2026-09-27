// Typed errors shared by every engine and surface, plus the CLI's stable exit codes (PLAN §7).

export type ErrorCode =
  | 'E_IMPOSSIBLE'
  | 'E_UNSUPPORTED'
  | 'E_UNSUPPORTED_BROWSER'
  | 'E_UNSUPPORTED_ENCODER'
  | 'E_FFMPEG_MISSING'
  | 'E_FIT_FAILED'
  | 'E_STALL'
  | 'E_CANCELLED'
  | 'E_EXISTS'
  | 'E_ARGS'
  | 'E_PRESET'
  | 'E_TRIM'
  | 'E_JOB'
  | 'E_JOB_VERSION'
  | 'E_ENCODE'
  | 'E_IO'
  | 'E_QUOTA'
  | 'E_INTERNAL';

export class SnugclipError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  /** Extra machine-readable data (e.g. minimumBytes). */
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, opts: { hint?: string; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'SnugclipError';
    this.code = code;
    this.hint = opts.hint;
    this.details = opts.details ?? {};
  }
  toJSON(): { code: ErrorCode; message: string; hint?: string } {
    return this.hint ? { code: this.code, message: this.message, hint: this.hint } : { code: this.code, message: this.message };
  }
}

export function isSnugclipError(e: unknown): e is SnugclipError {
  return e instanceof SnugclipError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'SnugclipError' && typeof (e as { code?: unknown }).code === 'string');
}

/** True for cancellation from any source (DOMException AbortError, mediabunny ConversionCanceledError, ours). */
export function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: string; code?: string };
  return err.name === 'AbortError' || err.name === 'ConversionCanceledError' || err.code === 'E_CANCELLED';
}

export function throwIfAborted(signal: { readonly aborted: boolean } | undefined): void {
  if (signal?.aborted) throw new SnugclipError('E_CANCELLED', 'Cancelled.');
}

/** Stable CLI exit codes (documented in AGENTS.md). */
export const EXIT = { OK: 0, OTHER: 1, IMPOSSIBLE: 2, UNSUPPORTED: 3, FFMPEG_MISSING: 4 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitCodeFor(code: string | null | undefined): ExitCode {
  if (!code) return EXIT.OK;
  switch (code) {
    case 'E_IMPOSSIBLE':
      return EXIT.IMPOSSIBLE;
    case 'E_UNSUPPORTED':
    case 'E_UNSUPPORTED_BROWSER':
    case 'E_UNSUPPORTED_ENCODER':
      return EXIT.UNSUPPORTED;
    case 'E_FFMPEG_MISSING':
      return EXIT.FFMPEG_MISSING;
    default:
      return EXIT.OTHER;
  }
}

/** Batch exit code with PLAN §7.1 precedence 4 > 1 > 3 > 2 > 0. */
export function combineExitCodes(codes: readonly number[]): ExitCode {
  for (const c of [4, 1, 3, 2] as const) if (codes.includes(c)) return c;
  return EXIT.OK;
}

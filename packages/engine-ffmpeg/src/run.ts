// Spawns ffmpeg/ffprobe with abort support: SIGTERM, then SIGKILL after 2 s (PLAN §8.1).
import { spawn } from 'node:child_process';
import { SnugclipError, type AbortSignalLike } from '@snugclip/core';

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

const live = new Set<ReturnType<typeof spawn>>();

/** Kills every ffmpeg child this process started (used on SIGINT/SIGTERM). */
export function killAllChildren(): void {
  for (const c of live) c.kill('SIGKILL');
  live.clear();
}

export function abortError(): Error {
  const e = new Error('Cancelled.');
  e.name = 'AbortError';
  return e;
}

export function run(
  bin: string,
  args: string[],
  opts: { signal?: AbortSignalLike; onStdout?: (chunk: string) => void; collectStdout?: boolean; stderrLimit?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError());
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(child);
    const out: Buffer[] = [];
    let err = '';
    const limit = opts.stderrLimit ?? 256 * 1024;
    let aborted = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref?.();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout!.on('data', (d: Buffer) => {
      if (opts.collectStdout) out.push(d);
      opts.onStdout?.(d.toString('utf8'));
    });
    child.stderr!.on('data', (d: Buffer) => {
      err += d.toString('utf8');
      if (err.length > limit) err = err.slice(-limit);
    });
    child.on('error', (e) => {
      live.delete(child);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new SnugclipError('E_FFMPEG_MISSING', `Couldn't run ${bin}: ${e.message}`, { cause: e }));
    });
    child.on('close', (code) => {
      live.delete(child);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (aborted) return reject(abortError());
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

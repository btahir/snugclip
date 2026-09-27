// Large outputs stream into an Origin Private File System file instead of memory (PLAN §8.2,
// §8.7). Files are named snugclip-*.{mp4,webm}; the app deletes them on remove (engine.discard)
// and on next load (cleanupOpfsOutputs).
import type { ContainerId } from '@snugclip/core';
import { SnugclipError } from '@snugclip/core';
import { StreamTarget } from 'mediabunny';
import type { StreamTargetChunk } from 'mediabunny';

export const OPFS_PREFIX = 'snugclip-';

export function isSnugclipOpfsName(name: string): boolean {
  return name.startsWith(OPFS_PREFIX) && /\.(mp4|webm|part)$/.test(name);
}

export function opfsFileName(id: string, container: ContainerId): string {
  return `${OPFS_PREFIX}${id.replace(/[^A-Za-z0-9-]/g, '')}.${container}`;
}

/** Enough free quota for `neededBytes` (unknown quota counts as enough; the write will tell). */
export function hasRoom(estimate: { quota?: number; usage?: number } | null | undefined, neededBytes: number): boolean {
  if (!estimate || typeof estimate.quota !== 'number') return true;
  return estimate.quota - (estimate.usage ?? 0) >= neededBytes;
}

// Minimal structural types: createSyncAccessHandle lives in the WebWorker lib, which conflicts
// with the DOM lib this package compiles against.
interface SyncAccessHandle {
  write(data: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}
interface OpfsFileHandle {
  getFile(): Promise<File>;
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
  createWritable?: () => Promise<WritableStream<StreamTargetChunk>>;
}
interface OpfsDir {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string): Promise<void>;
  keys?: () => AsyncIterable<string>;
}
interface StorageLike {
  getDirectory?: () => Promise<OpfsDir>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
}

function storage(): StorageLike | null {
  const nav = (globalThis as { navigator?: { storage?: StorageLike } }).navigator;
  return nav?.storage ?? null;
}

export function opfsAvailable(): boolean {
  return typeof storage()?.getDirectory === 'function' && typeof WritableStream !== 'undefined';
}

export async function ensureQuota(neededBytes: number): Promise<void> {
  const s = storage();
  const est = s?.estimate ? await s.estimate().catch(() => null) : null;
  if (!hasRoom(est, neededBytes)) {
    throw new SnugclipError('E_QUOTA', 'Not enough free storage in this browser for the output.', {
      hint: 'Free some disk space, trim the clip, or pick a smaller limit.',
      details: { neededBytes, quota: est?.quota, usage: est?.usage },
    });
  }
}

export interface OpfsSink {
  readonly name: string;
  readonly target: StreamTarget;
  /** After output.finalize(): the file as a Blob (a File backed by OPFS). */
  finish(): Promise<Blob>;
  /** Deletes the file (after failure, or when the user removes the output). */
  remove(): Promise<void>;
}

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createOpfsSink(container: ContainerId): Promise<OpfsSink> {
  const s = storage();
  if (!s?.getDirectory) throw new SnugclipError('E_QUOTA', 'This browser has no private file storage for large outputs.');
  const dir = await s.getDirectory();
  const name = opfsFileName(randomId(), container);
  const handle = await dir.getFileHandle(name, { create: true });
  let writable: WritableStream<StreamTargetChunk>;
  let closeSync = () => {};
  if (typeof handle.createSyncAccessHandle === 'function') {
    // Workers: synchronous positioned writes, the fastest path.
    const sync = await handle.createSyncAccessHandle();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      sync.flush();
      sync.close();
    };
    closeSync = close;
    writable = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        sync.write(chunk.data, { at: chunk.position });
      },
      close,
      abort: close,
    });
  } else if (typeof handle.createWritable === 'function') {
    // Main thread: FileSystemWritableFileStream accepts { type: 'write', data, position } chunks as-is.
    writable = await handle.createWritable();
  } else {
    await dir.removeEntry(name).catch(() => {});
    throw new SnugclipError('E_QUOTA', "This browser can't write large outputs to private storage.");
  }
  return {
    name,
    target: new StreamTarget(writable, { chunked: true }),
    finish: () => {
      closeSync(); // idempotent; the sync handle locks the file until closed
      return handle.getFile();
    },
    remove: async () => {
      try {
        closeSync();
      } catch {
        /* already closed */
      }
      await dir.removeEntry(name).catch(() => {});
    },
  };
}

/** Deletes leftover snugclip-* OPFS files (call on app load). Returns how many were removed. */
export async function cleanupOpfsOutputs(): Promise<number> {
  const s = storage();
  if (!s?.getDirectory) return 0;
  const dir = await s.getDirectory();
  if (!dir.keys) return 0;
  const names: string[] = [];
  for await (const n of dir.keys()) if (isSnugclipOpfsName(n)) names.push(n);
  let removed = 0;
  for (const n of names) {
    try {
      await dir.removeEntry(n);
      removed++;
    } catch {
      /* in use by another tab: leave it */
    }
  }
  return removed;
}

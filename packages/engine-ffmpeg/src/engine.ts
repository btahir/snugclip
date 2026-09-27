// The ffmpeg Engine (PLAN §8.1): the user's own ffmpeg/ffprobe, two-pass libx264 by default.
// Outputs are written as `<final>.snugclip-<pid>-<n>.tmp` next to the final file and only renamed
// into place by commit(), which the core calls only when bytes ≤ target.
import { copyFile, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { constants as fsConst, existsSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { platform } from 'node:os';
import {
  SnugclipError,
  type AbortSignalLike,
  type EncodePlan,
  type EncodeResult,
  type Engine,
  type EngineCapabilities,
  type LumaFrame,
  type Probe,
  type Warning,
} from '@snugclip/core';
import { detectFfmpeg, type DetectOptions, type FfmpegInfo } from './detect.js';
import { buildArgs, buildCapabilities, frameDims, parseProgress, parseSummary, pickEncoders, TWO_PASS, type EncoderId } from './encoders.js';
import { mapFfprobe, type FfprobeJson } from './probe-map.js';
import { abortError, run } from './run.js';

export interface FfOutput {
  /** Current location (temp until committed). */
  path: string;
  /** Where commit() moves it. */
  finalPath: string;
  bytes: number;
  committed: boolean;
  passThrough?: boolean;
}

export interface FfmpegEngineOptions extends DetectOptions {
  /** Threads for every ffmpeg run (machine rule: 4). */
  threads?: number;
  /** Test-only: pin an encoder (also SNUGCLIP_FORCE_ENCODER). */
  forceEncoder?: string;
  /**
   * Final output path for an input. `ext` is 'mp4' | 'webm' for encodes, or the source's own
   * extension for pass-through copies. Default: next to the input as `<stem>-snug.<ext>`.
   */
  outputFor?: (inputPath: string, ext: string) => string;
  /** Replace an existing final file (else commit/passThrough throw E_EXISTS). */
  overwrite?: boolean;
}

let tmpCounter = 0;

export class FfmpegEngine implements Engine<string, FfOutput> {
  readonly id = 'ffmpeg' as const;
  private info: FfmpegInfo | null = null;
  private caps: EngineCapabilities | null = null;
  private probes = new Map<string, Probe>();
  private temps = new Set<string>();
  constructor(private readonly opts: FfmpegEngineOptions = {}) {}

  /** Detects ffmpeg lazily; throws E_FFMPEG_MISSING. */
  ffmpeg(): FfmpegInfo {
    if (!this.info) this.info = detectFfmpeg(this.opts);
    return this.info;
  }

  private get threads(): number {
    return this.opts.threads ?? 4;
  }

  private force(): string | undefined {
    return this.opts.forceEncoder ?? (this.opts.env ?? process.env).SNUGCLIP_FORCE_ENCODER;
  }

  async capabilities(): Promise<EngineCapabilities> {
    if (!this.caps) {
      const info = this.ffmpeg();
      this.caps = buildCapabilities(info.version, info.encoders, this.force());
    }
    return this.caps;
  }

  /** Warnings the core can't know about (e.g. HDR without zscale). */
  warningsFor(probe: Probe): Warning[] {
    const info = this.ffmpeg();
    if (probe.video?.hdr && !(info.filters.has('zscale') && info.filters.has('tonemap'))) {
      return [{ code: 'hdr-not-tonemapped', message: "This ffmpeg has no zscale filter, so HDR colours aren't tone-mapped and may look washed out. Install an ffmpeg built with zimg for better colours." }];
    }
    return [];
  }

  async probe(input: string): Promise<Probe> {
    const hit = this.probes.get(input);
    if (hit) return hit;
    const info = this.ffmpeg();
    let size: number;
    try {
      size = (await stat(input)).size;
    } catch (e) {
      throw new SnugclipError('E_IO', `Can't read ${input}: ${(e as Error).message}`);
    }
    const r = await run(info.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input], { collectStdout: true });
    if (r.code !== 0) {
      throw new SnugclipError('E_UNSUPPORTED', `ffprobe couldn't read this file${r.stderr.trim() ? `: ${r.stderr.trim().split('\n').at(-1)}` : ''}.`, {
        hint: 'Is it a video? Snugclip reads anything your ffmpeg can decode.',
      });
    }
    let json: FfprobeJson;
    try {
      json = JSON.parse(r.stdout.toString('utf8')) as FfprobeJson;
    } catch {
      throw new SnugclipError('E_UNSUPPORTED', "ffprobe's output couldn't be read.");
    }
    const probe = mapFfprobe(json, input, size);
    this.probes.set(input, probe);
    return probe;
  }

  private finalFor(input: string, ext: string): string {
    if (this.opts.outputFor) return this.opts.outputFor(input, ext);
    const stem = basename(input, extname(input));
    return join(dirname(input), `${stem}-snug.${ext}`);
  }

  private tempFor(finalPath: string): string {
    tmpCounter += 1;
    return `${finalPath}.snugclip-${process.pid}-${tmpCounter}.tmp`;
  }

  async encode(plan: EncodePlan<string>, opts: { signal: AbortSignalLike; onProgress?: (p: { fraction: number; encodedSec: number }) => void }): Promise<EncodeResult<FfOutput>> {
    const info = this.ffmpeg();
    const caps = await this.capabilities();
    const encoder = caps.encoderName[plan.video.codec] as EncoderId | undefined;
    if (!encoder) throw new SnugclipError('E_UNSUPPORTED_ENCODER', `No ${plan.video.codec} encoder in this ffmpeg.`);
    const probe = await this.probe(plan.input);
    const finalPath = this.finalFor(plan.input, plan.container);
    const tmp = this.tempFor(finalPath);
    const passlog = tmp.replace(/\.tmp$/, '.passlog');
    const D = plan.trim ? plan.trim.endSec - plan.trim.startSec : probe.durationSec;
    const twoPass = TWO_PASS.has(encoder);
    const ctx = {
      input: plan.input,
      output: tmp,
      encoder,
      passlog,
      sourceFps: probe.video?.fps ?? 30,
      threads: this.threads,
      tonemap: info.filters.has('zscale') && info.filters.has('tonemap'),
      opusEncoder: (info.encoders.has('libopus') ? 'libopus' : 'opus') as 'libopus' | 'opus',
      nullSink: platform() === 'win32' ? 'NUL' : '/dev/null',
    };
    this.temps.add(tmp);
    const passes: (1 | 2 | null)[] = twoPass ? [1, 2] : [null];
    let stderr = '';
    try {
      for (let i = 0; i < passes.length; i++) {
        const pass = passes[i]!;
        const share = passes.length === 2 ? (i === 0 ? [0, 0.4] : [0.4, 1]) : [0, 1];
        let buf = '';
        const r = await run(info.ffmpeg, buildArgs(plan, { ...ctx, pass }), {
          signal: opts.signal,
          onStdout: (chunk) => {
            buf += chunk;
            const nl = buf.lastIndexOf('\n');
            if (nl === -1) return;
            const t = parseProgress(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            if (t !== null && D > 0) {
              const f = Math.min(1, Math.max(0, t / D));
              opts.onProgress?.({ fraction: share[0]! + (share[1]! - share[0]!) * f, encodedSec: pass === 1 ? 0 : Math.min(D, t) });
            }
          },
        });
        if (r.code !== 0) {
          const tail = r.stderr.trim().split('\n').slice(-3).join(' | ');
          throw new SnugclipError('E_ENCODE', `ffmpeg (${encoder}) failed: ${tail || `exit ${r.code}`}`);
        }
        stderr = r.stderr;
      }
      const bytes = (await stat(tmp)).size;
      const s = parseSummary(stderr);
      opts.onProgress?.({ fraction: 1, encodedSec: D });
      return {
        output: { path: tmp, finalPath, bytes, committed: false },
        bytes,
        ...(s.videoBytes !== undefined ? { videoBytes: s.videoBytes } : {}),
        ...(s.audioBytes !== undefined ? { audioBytes: s.audioBytes } : {}),
        durationSec: D,
        encoder,
      };
    } catch (e) {
      await this.removeTemp(tmp);
      throw e;
    } finally {
      await this.removePasslog(passlog);
    }
  }

  private async removePasslog(passlog: string): Promise<void> {
    const dir = dirname(passlog);
    const base = basename(passlog);
    const files = await readdir(dir).catch(() => [] as string[]);
    await Promise.all(files.filter((f) => f.startsWith(base)).map((f) => rm(join(dir, f), { force: true })));
  }

  private async removeTemp(p: string): Promise<void> {
    this.temps.delete(p);
    await rm(p, { force: true });
  }

  /** Deletes every temp file this engine still owns (SIGINT/SIGTERM cleanup). */
  async cleanup(): Promise<void> {
    await Promise.all([...this.temps].map((p) => this.removeTemp(p)));
  }

  /** Synchronous variant for process 'exit' handlers. */
  cleanupSync(): void {
    for (const p of this.temps) rmSync(p, { force: true });
    this.temps.clear();
  }

  async frames(src: string | FfOutput, timesSec: number[], evalShortSide: number, signal: AbortSignalLike): Promise<LumaFrame[]> {
    const info = this.ffmpeg();
    const path = typeof src === 'string' ? src : src.path;
    const probe = typeof src === 'string' ? await this.probe(src) : await this.probeUncached(path);
    const v = probe.video!;
    const { width, height } = frameDims(v.displayWidth, v.displayHeight, evalShortSide);
    const out: LumaFrame[] = [];
    for (const t of timesSec) {
      if (signal.aborted) throw abortError();
      const at = Math.max(0, Math.min(t, probe.durationSec - 0.05));
      const r = await run(
        info.ffmpeg,
        ['-hide_banner', '-nostdin', '-v', 'error', '-ss', at.toFixed(3), '-i', path, '-frames:v', '1', '-vf', `scale=${width}:${height}:flags=bicubic,format=rgba`, '-threads', String(this.threads), '-f', 'rawvideo', 'pipe:1'],
        { signal, collectStdout: true },
      );
      if (r.code !== 0 || r.stdout.length < width * height * 4) {
        throw new SnugclipError('E_ENCODE', `Couldn't decode a frame at ${at.toFixed(2)} s for the quality check.`);
      }
      out.push({ width, height, data: new Uint8ClampedArray(r.stdout.buffer, r.stdout.byteOffset, width * height * 4) });
    }
    return out;
  }

  private async probeUncached(path: string): Promise<Probe> {
    this.probes.delete(path);
    const p = await this.probe(path);
    this.probes.delete(path);
    return p;
  }

  async passThrough(input: string): Promise<FfOutput> {
    const ext = extname(input).replace(/^\./, '') || 'mp4';
    const finalPath = this.finalFor(input, ext);
    if (existsSync(finalPath) && !this.opts.overwrite) throw existsError(finalPath);
    await copyFile(input, finalPath, this.opts.overwrite ? 0 : fsConst.COPYFILE_EXCL);
    const bytes = (await stat(finalPath)).size;
    return { path: finalPath, finalPath, bytes, committed: true, passThrough: true };
  }

  async commit(output: FfOutput): Promise<FfOutput> {
    if (output.committed) return output;
    if (existsSync(output.finalPath) && !this.opts.overwrite) {
      await this.removeTemp(output.path);
      throw existsError(output.finalPath);
    }
    await rename(output.path, output.finalPath);
    this.temps.delete(output.path);
    return { ...output, path: output.finalPath, committed: true };
  }

  async discard(output: FfOutput): Promise<void> {
    if (output.committed) return;
    this.temps.delete(output.path);
    await unlink(output.path).catch(() => {});
  }
}

function existsError(p: string): SnugclipError {
  return new SnugclipError('E_EXISTS', `${p} already exists.`, { hint: 'Pass --overwrite to replace it, or choose another -o/--out-dir.' });
}

export { pickEncoders };

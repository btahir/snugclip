// Finds the user's ffmpeg/ffprobe (never bundled) and what they can encode (PLAN §8.1).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { SnugclipError } from '@snugclip/core';

export interface DetectOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export interface FfmpegInfo {
  ffmpeg: string;
  ffprobe: string;
  version: string;
  encoders: Set<string>;
  filters: Set<string>;
}

export function installHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'Install it with: brew install ffmpeg';
  if (platform === 'win32') return 'Install it with: winget install Gyan.FFmpeg';
  return 'Install it with: sudo apt install ffmpeg (or your distro\'s package manager)';
}

function works(bin: string): boolean {
  const r = spawnSync(bin, ['-hide_banner', '-version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
  return !r.error && r.status === 0;
}

/** Candidate paths in PLAN §8.1 order: flag, env, PATH, well-known dirs. */
export function candidates(name: 'ffmpeg' | 'ffprobe', flag: string | undefined, env: Record<string, string | undefined>, platform: NodeJS.Platform): string[] {
  const out: string[] = [];
  if (flag) return [flag];
  const envVar = env[name === 'ffmpeg' ? 'SNUGCLIP_FFMPEG' : 'SNUGCLIP_FFPROBE'];
  if (envVar) return [envVar];
  const exe = platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) out.push(join(dir, exe));
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) out.push(join(dir, exe));
  return out;
}

function find(name: 'ffmpeg' | 'ffprobe', flag: string | undefined, env: Record<string, string | undefined>, platform: NodeJS.Platform): string | null {
  for (const c of candidates(name, flag, env, platform)) {
    if ((c.includes('/') || c.includes('\\')) && !existsSync(c)) continue;
    if (works(c)) return c;
  }
  return null;
}

const cache = new Map<string, FfmpegInfo>();

/** Detects ffmpeg + ffprobe once per (paths, env) and caches the result. Throws E_FFMPEG_MISSING. */
export function detectFfmpeg(opts: DetectOptions = {}): FfmpegInfo {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const key = JSON.stringify([opts.ffmpegPath, opts.ffprobePath, env.SNUGCLIP_FFMPEG, env.SNUGCLIP_FFPROBE, env.PATH]);
  const hit = cache.get(key);
  if (hit) return hit;
  const ffmpeg = find('ffmpeg', opts.ffmpegPath, env, platform);
  const ffprobe = find('ffprobe', opts.ffprobePath, env, platform);
  if (!ffmpeg || !ffprobe) {
    const missing = [!ffmpeg && 'ffmpeg', !ffprobe && 'ffprobe'].filter(Boolean).join(' and ');
    throw new SnugclipError('E_FFMPEG_MISSING', `Snugclip's CLI needs ${missing}, which ${missing.includes('and') ? "weren't" : "wasn't"} found.`, {
      hint: `${installHint(platform)}. Or point to it with --ffmpeg/--ffprobe or SNUGCLIP_FFMPEG/SNUGCLIP_FFPROBE.`,
    });
  }
  const ver = spawnSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' }).stdout ?? '';
  const version = /ffmpeg version (\S+)/.exec(ver)?.[1] ?? 'unknown';
  const enc = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', maxBuffer: 8 << 20 }).stdout ?? '';
  const flt = spawnSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 8 << 20 }).stdout ?? '';
  const info: FfmpegInfo = { ffmpeg, ffprobe, version, encoders: parseList(enc), filters: parseList(flt) };
  cache.set(key, info);
  return info;
}

/** Parses `ffmpeg -encoders` / `-filters` tables into a set of names. */
export function parseList(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^\s*[A-Z.|]{2,6}\s+(\S+)\s/.exec(line);
    if (m && m[1] !== '=' && !m[1]!.includes('=')) out.add(m[1]!);
  }
  return out;
}

export function clearDetectCache(): void {
  cache.clear();
}

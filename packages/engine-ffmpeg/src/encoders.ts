// Encoder choice and ffmpeg argument building (PLAN §8.1). Pure: tested without ffmpeg.
import { dimsForShortSide, type EncodePlan, type EngineCapabilities, type VideoCodecId } from '@snugclip/core';

export type EncoderId = 'libx264' | 'h264_videotoolbox' | 'libopenh264' | 'libx265' | 'hevc_videotoolbox' | 'libsvtav1' | 'libvpx-vp9';

const PREFERENCE: Record<VideoCodecId, EncoderId[]> = {
  h264: ['libx264', 'h264_videotoolbox', 'libopenh264'],
  hevc: ['libx265', 'hevc_videotoolbox'],
  av1: ['libsvtav1'],
  vp9: ['libvpx-vp9'],
};
const CODEC_OF: Record<EncoderId, VideoCodecId> = {
  libx264: 'h264',
  h264_videotoolbox: 'h264',
  libopenh264: 'h264',
  libx265: 'hevc',
  hevc_videotoolbox: 'hevc',
  libsvtav1: 'av1',
  'libvpx-vp9': 'vp9',
};
export const TWO_PASS = new Set<EncoderId>(['libx264', 'libx265', 'libvpx-vp9']);

/**
 * First available encoder per codec. `force` (SNUGCLIP_FORCE_ENCODER, test-only) pins one
 * encoder for its codec, e.g. h264_videotoolbox.
 */
export function pickEncoders(available: Set<string>, force?: string): Partial<Record<VideoCodecId, EncoderId>> {
  const out: Partial<Record<VideoCodecId, EncoderId>> = {};
  for (const [codec, list] of Object.entries(PREFERENCE) as [VideoCodecId, EncoderId[]][]) {
    const e = list.find((x) => available.has(x));
    if (e) out[codec] = e;
  }
  if (force && force in CODEC_OF && available.has(force)) out[CODEC_OF[force as EncoderId]] = force as EncoderId;
  return out;
}

export function buildCapabilities(version: string, available: Set<string>, force?: string): EngineCapabilities {
  const enc = pickEncoders(available, force);
  const videoCodecs = (Object.keys(enc) as VideoCodecId[]).filter((c) => enc[c]);
  const audioCodecs: EngineCapabilities['audioCodecs'] = [];
  if (available.has('aac')) audioCodecs.push('aac');
  if (available.has('libopus') || available.has('opus')) audioCodecs.push('opus');
  const twoPassCodecs = videoCodecs.filter((c) => TWO_PASS.has(enc[c]!));
  const marginByCodec: Partial<Record<VideoCodecId, number>> = {};
  for (const c of videoCodecs) marginByCodec[c] = TWO_PASS.has(enc[c]!) ? 0.02 : 0.04;
  return {
    id: 'ffmpeg',
    version,
    encoderName: enc,
    videoCodecs,
    audioCodecs,
    containers: ['mp4', 'webm'],
    twoPass: enc.h264 ? TWO_PASS.has(enc.h264) : false,
    twoPassCodecs,
    initialMargin: enc.h264 && TWO_PASS.has(enc.h264) ? 0.02 : 0.04,
    marginByCodec,
    rateCalibration: 'auto',
    audioCopyWithTrim: true,
    // VideoToolbox tops out around 4096 px on the long side on most Macs.
    maxEncodeShortSide: Object.fromEntries(videoCodecs.filter((c) => /videotoolbox/.test(enc[c]!)).map((c) => [c, 2160])),
    canEncode: () => true,
  };
}

export interface ArgContext {
  input: string;
  output: string;
  encoder: EncoderId;
  /** 1 or 2 for two-pass encoders, null for single pass. */
  pass: 1 | 2 | null;
  passlog: string;
  sourceFps: number;
  threads: number;
  /** zscale+tonemap available (HDR → SDR tone mapping). */
  tonemap: boolean;
  opusEncoder: 'libopus' | 'opus';
  nullSink: string;
}

const k = (bps: number) => `${Math.max(1, Math.round(bps / 1000))}k`;

export function videoFilter(plan: EncodePlan<string>, ctx: Pick<ArgContext, 'sourceFps' | 'tonemap'>): string {
  const v = plan.video;
  const parts: string[] = [];
  if (plan.hdrToSdr && ctx.tonemap) {
    parts.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  }
  parts.push(`scale=${v.width}:${v.height}:flags=lanczos`);
  if (Math.abs(v.fps - ctx.sourceFps) > 0.01) parts.push(`fps=${v.fps}`);
  parts.push('format=yuv420p');
  return parts.join(',');
}

function videoCodecArgs(plan: EncodePlan<string>, ctx: ArgContext): string[] {
  const v = plan.video;
  const g = String(Math.max(1, Math.round(v.keyframeIntervalSec * v.fps)));
  const rate = ['-b:v', k(v.bitrate), '-maxrate', k(v.bitrate * 1.5), '-bufsize', k(v.bitrate * 2)];
  switch (ctx.encoder) {
    case 'libx264':
      return ['-c:v', 'libx264', '-preset', 'medium', ...(ctx.pass === 2 ? ['-profile:v', 'high'] : []), ...rate, '-g', g, '-pass', String(ctx.pass ?? 1), '-passlogfile', ctx.passlog];
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', ...rate, '-profile:v', 'high', '-g', g];
    case 'libopenh264':
      return ['-c:v', 'libopenh264', '-rc_mode', 'bitrate', '-b:v', k(v.bitrate), '-maxrate', k(v.bitrate * 1.5), '-g', g];
    case 'libx265': {
      const kb = Math.round(v.bitrate / 1000);
      const params = `pass=${ctx.pass ?? 1}:stats=${ctx.passlog}:log-level=error:vbv-maxrate=${Math.round(kb * 1.5)}:vbv-bufsize=${kb * 2}:keyint=${g}`;
      return ['-c:v', 'libx265', '-preset', 'medium', '-b:v', k(v.bitrate), '-x265-params', params, '-tag:v', 'hvc1'];
    }
    case 'hevc_videotoolbox':
      return ['-c:v', 'hevc_videotoolbox', ...rate, '-g', g, '-tag:v', 'hvc1'];
    case 'libsvtav1':
      return ['-c:v', 'libsvtav1', '-b:v', k(v.bitrate), '-preset', '8', '-g', g, '-svtav1-params', 'rc=1'];
    case 'libvpx-vp9':
      return ['-c:v', 'libvpx-vp9', ...rate, '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-g', g, '-pass', String(ctx.pass ?? 1), '-passlogfile', ctx.passlog];
  }
}

function audioArgs(plan: EncodePlan<string>, ctx: ArgContext): string[] {
  const a = plan.audio;
  if (a.mode === 'none') return ['-an'];
  if (a.mode === 'copy') return ['-map', '0:a:0', '-c:a', 'copy'];
  const common = ['-map', '0:a:0', '-b:a', k(a.bitrate ?? 64_000), '-ac', String(a.channels ?? 2), '-ar', String(a.sampleRate ?? 48000)];
  if (a.codec === 'opus') return [...common, '-c:a', ctx.opusEncoder, ...(ctx.opusEncoder === 'opus' ? ['-strict', '-2'] : [])];
  return [...common, '-c:a', 'aac'];
}

/** Full ffmpeg argv for one pass. Pass 1 of a two-pass encode writes to the null sink with no audio. */
export function buildArgs(plan: EncodePlan<string>, ctx: ArgContext): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'info', '-nostats'];
  if (plan.trim) args.push('-ss', plan.trim.startSec.toFixed(3), '-t', (plan.trim.endSec - plan.trim.startSec).toFixed(3));
  args.push('-i', ctx.input, '-map', '0:v:0', '-vf', videoFilter(plan, ctx), ...videoCodecArgs(plan, ctx));
  if (ctx.pass === 1) {
    args.push('-an', '-threads', String(ctx.threads), '-progress', 'pipe:1', '-f', 'null', ctx.nullSink);
    return args;
  }
  args.push(...audioArgs(plan, ctx));
  if (plan.container === 'mp4') args.push('-movflags', '+faststart');
  args.push('-map_metadata', '-1', '-map_chapters', '-1', '-max_muxing_queue_size', '4096', '-threads', String(ctx.threads), '-progress', 'pipe:1');
  args.push('-f', plan.container, ctx.output);
  return args;
}

/** Scale filter for quality frames: short side = evalShortSide in display orientation (may upscale). */
export function frameDims(displayW: number, displayH: number, evalShortSide: number): { width: number; height: number } {
  const short = Math.min(displayW, displayH);
  if (evalShortSide <= short) return dimsForShortSide(displayW, displayH, evalShortSide);
  const long = Math.round((Math.max(displayW, displayH) * evalShortSide) / short / 2) * 2;
  return displayW >= displayH ? { width: long, height: evalShortSide } : { width: evalShortSide, height: long };
}

/** Parses `-progress pipe:1` output into encoded seconds (out_time_us is µs; so is out_time_ms, despite the name). */
export function parseProgress(chunk: string): number | null {
  let last: number | null = null;
  for (const line of chunk.split('\n')) {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
    if (m) last = Number(m[1]) / 1e6;
  }
  return last;
}

/** Parses the final `video:NKiB audio:NKiB …` summary into bytes. */
export function parseSummary(stderr: string): { videoBytes?: number; audioBytes?: number } {
  const lines = stderr.split('\n').filter((l) => /video:\s*\d+(\.\d+)?\s*[kKM]i?B\s+audio:/.test(l));
  const line = lines.at(-1);
  if (!line) return {};
  const unit = (n: string, u: string) => Number(n) * (u.startsWith('M') ? 1048576 : u.startsWith('k') || u.startsWith('K') ? 1024 : 1);
  const v = /video:\s*([\d.]+)\s*([kKM]i?B)/.exec(line);
  const a = /audio:\s*([\d.]+)\s*([kKM]i?B)/.exec(line);
  const out: { videoBytes?: number; audioBytes?: number } = {};
  if (v) out.videoBytes = Math.round(unit(v[1]!, v[2]!));
  if (a) out.audioBytes = Math.round(unit(a[1]!, a[2]!));
  return out;
}

// The planner: a pure function from (probe, target, options, capabilities) to a Plan.
// No I/O, no clock, no randomness. The web app, CLI and MCP all call this same function,
// so the same probe always gets the same plan on every surface.
import { SnugclipError } from './errors.js';
import { TUNING } from './tuning.js';
import type {
  AudioCodec,
  Budget,
  Capabilities,
  CodecChoice,
  Container,
  EncodeAudio,
  EncodeSpec,
  EncodeVideo,
  Options,
  Plan,
  Probe,
  ResolvedOptions,
  Rung,
  Target,
  TrimRange,
  VideoCodec,
} from './types.js';
import { formatBytes, formatBitrate } from './units.js';

/** Capabilities that assume every codec is encodable (used for dry-run plans and tests). */
export const ALL_CAPABILITIES: Capabilities = {
  video: ['h264', 'hevc', 'av1', 'vp9'],
  audio: ['aac', 'opus'],
  audioCopy: ['aac', 'opus'],
  rateControl: 'two-pass',
};

export function resolveOptions(o: Options = {}): ResolvedOptions {
  const fps = o.fps ?? 'auto';
  if (typeof fps === 'number' && !(fps > 0 && fps <= 240)) {
    throw new SnugclipError('INVALID_ARGUMENT', `fps must be between 1 and 240 (got ${fps}).`);
  }
  if (o.maxHeight != null && !(Number.isFinite(o.maxHeight) && o.maxHeight >= 64)) {
    throw new SnugclipError('INVALID_ARGUMENT', `max height must be at least 64 (got ${o.maxHeight}).`);
  }
  return {
    codec: o.codec ?? 'compatible',
    maxHeight: o.maxHeight == null ? null : Math.floor(o.maxHeight),
    fps,
    trim: o.trim ?? null,
    mute: o.mute ?? false,
    reencode: o.reencode ?? false,
  };
}

/** Validates and clamps a trim range against the source duration. Null when it covers everything. */
export function normalizeTrim(trim: TrimRange | null, durationSec: number): TrimRange | null {
  if (!trim) return null;
  const start = Math.max(0, trim.start);
  const end = Math.min(durationSec, trim.end);
  if (!(Number.isFinite(start) && Number.isFinite(end)) || end - start < 0.1) {
    throw new SnugclipError('INVALID_ARGUMENT', `Trim range ${trim.start}–${trim.end} s is empty or outside the ${durationSec.toFixed(2)} s clip.`);
  }
  if (start <= 0.001 && end >= durationSec - 0.001) return null;
  return { start, end };
}

/** Picks the output video codec and container for a codec choice and engine capabilities. */
export function resolveCodec(choice: CodecChoice, caps: Capabilities): { codec: VideoCodec; container: Container; warnings: string[] } {
  const has = (c: VideoCodec) => caps.video.includes(c);
  const containerFor = (c: VideoCodec): Container => (c === 'vp9' ? 'webm' : 'mp4');
  const warnings: string[] = [];
  let order: VideoCodec[];
  if (choice === 'compatible') order = ['h264', 'vp9', 'av1', 'hevc'];
  else if (choice === 'smaller') order = ['av1', 'hevc', 'vp9', 'h264'];
  else {
    if (!has(choice)) {
      throw new SnugclipError('ENCODER_MISSING', `This engine can't encode ${choice.toUpperCase()} here.`, { codec: choice, available: caps.video });
    }
    return { codec: choice, container: containerFor(choice), warnings };
  }
  const codec = order.find(has);
  if (!codec) throw new SnugclipError('ENCODER_MISSING', 'No usable video encoder is available.', { available: caps.video });
  if (choice === 'compatible' && codec !== 'h264') warnings.push(`H.264 isn't available here, so Snugclip used ${codec.toUpperCase()}; some players may not open it.`);
  if (choice === 'smaller' && (codec === 'av1' || codec === 'hevc')) warnings.push(`${codec === 'av1' ? 'AV1' : 'HEVC'} makes smaller files but older phones and some apps can't play it.`);
  if (choice === 'smaller' && (codec === 'h264' || codec === 'vp9')) warnings.push(`Neither AV1 nor HEVC can be encoded here, so Snugclip used ${codec.toUpperCase()}.`);
  return { codec, container: containerFor(codec), warnings };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output dimensions for a given shorter side, keeping the display aspect ratio. */
export function dimsForShortSide(srcW: number, srcH: number, shortSide: number): { width: number; height: number } {
  const srcShort = Math.min(srcW, srcH);
  const s = Math.min(shortSide, srcShort);
  const scale = s / srcShort;
  if (srcW <= srcH) return { width: even(s), height: even(srcH * scale) };
  return { width: even(srcW * scale), height: even(s) };
}

/** Halves high frame rates (60→30, 59.94→29.97, 50→25); anything else above 30 becomes 30. */
function droppedFps(fps: number): number {
  if (fps >= 47) return Math.round((fps / 2) * 1000) / 1000;
  return Math.min(fps, TUNING.fpsDropAbove);
}

function startFps(srcFps: number, policy: ResolvedOptions['fps']): number {
  const f = srcFps > 0 && Number.isFinite(srcFps) ? srcFps : 30;
  if (policy === 'keep') return f;
  if (typeof policy === 'number') return Math.min(f, policy);
  return Math.min(f, TUNING.maxAutoFps);
}

export function overheadBytes(container: Container, durationSec: number, fps: number, audio: { sampleRate: number; codec: AudioCodec } | null): number {
  const m = TUNING.overhead[container];
  const videoSamples = Math.ceil(durationSec * fps);
  const audioSamples = audio ? Math.ceil((durationSec * audio.sampleRate) / (audio.codec === 'aac' ? 1024 : 960)) : 0;
  return Math.ceil(m.fixed + m.perSample * (videoSamples + audioSamples));
}

/** Target bpp and floor bpp for a codec. */
export function bppFor(codec: VideoCodec): { target: number; floor: number } {
  const k = TUNING.codecEfficiency[codec];
  return { target: TUNING.targetBpp * k, floor: TUNING.floorBpp * k };
}

/** Builds the candidate ladder: source rung (fps drop first in auto), then each smaller rung. */
export function buildLadder(probe: Probe, opts: ResolvedOptions): Omit<Rung, 'bpp'>[] {
  const v = probe.video!;
  const srcShort = Math.min(v.width, v.height);
  const cap = opts.maxHeight ? Math.min(opts.maxHeight, srcShort) : srcShort;
  const f0 = startFps(v.fps, opts.fps);
  const canDrop = opts.fps === 'auto' && f0 > TUNING.fpsDropAbove;
  const f1 = canDrop ? droppedFps(f0) : f0;
  const out: Omit<Rung, 'bpp'>[] = [];
  const top = dimsForShortSide(v.width, v.height, cap);
  out.push({ ...top, fps: f0 });
  if (canDrop) out.push({ ...top, fps: f1 });
  for (const r of TUNING.rungs) {
    if (r >= cap) continue;
    out.push({ ...dimsForShortSide(v.width, v.height, r), fps: f1 });
  }
  return out;
}

function pickAudioBitrate(totalBps: number, srcBitrate: number | null, channels: number): number {
  const cap = Math.min(
    totalBps * TUNING.audioShare,
    channels <= 1 ? TUNING.monoAudioCap : Infinity,
    srcBitrate && srcBitrate > 0 ? Math.max(srcBitrate, TUNING.audioLadder.at(-1)!) : Infinity,
  );
  return TUNING.audioLadder.find((b) => b <= cap) ?? TUNING.audioLadder.at(-1)!;
}

export interface PlanInput {
  probe: Probe;
  target: Target;
  options?: Options;
  capabilities?: Capabilities;
}

/**
 * Plans a compression. Never throws for impossible targets (returns mode `impossible` with
 * `minimumBytes`); throws SnugclipError for unusable input or invalid options.
 */
export function plan({ probe, target, options, capabilities = ALL_CAPABILITIES }: PlanInput): Plan {
  if (!(Number.isFinite(target.bytes) && target.bytes > 0)) {
    throw new SnugclipError('INVALID_ARGUMENT', `Target must be a positive number of bytes (got ${target.bytes}).`);
  }
  const opts = resolveOptions(options);
  if (!probe.video) throw new SnugclipError('UNSUPPORTED_INPUT', 'This file has no video track.');
  if (!(probe.durationSec > 0)) throw new SnugclipError('UNSUPPORTED_INPUT', "Couldn't read this video's duration.");
  const v = probe.video;
  const trim = normalizeTrim(opts.trim, probe.durationSec);
  opts.trim = trim;
  const duration = trim ? trim.end - trim.start : probe.durationSec;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const targetBytes = Math.floor(target.bytes);
  const srcShort = Math.min(v.width, v.height);
  const hasAudio = !!probe.audio && !opts.mute;

  // 1. Pass-through: already under the target and nothing asks for a change.
  const needsChange =
    opts.reencode ||
    trim !== null ||
    (opts.mute && !!probe.audio) ||
    (opts.maxHeight !== null && opts.maxHeight < srcShort) ||
    (typeof opts.fps === 'number' && opts.fps < v.fps - 0.01);
  const { codec, container, warnings: codecWarnings } = resolveCodec(opts.codec, capabilities);
  const audioCodec: AudioCodec | null = hasAudio ? (container === 'webm' ? 'opus' : 'aac') : null;
  const base = {
    target: { ...target, bytes: targetBytes },
    options: opts,
    durationSec: duration,
    videoCodec: codec,
    audioCodec,
    container,
  };

  // Ladder and minimum size are computed in every mode so `snugclip plan` can always show them.
  const bpp = bppFor(codec);
  const ladderDims = buildLadder(probe, opts);
  const bottom = ladderDims.at(-1)!;
  const minAudioBps = hasAudio ? TUNING.audioLadder.at(-1)! : 0;
  const minAudioSr = container === 'webm' ? 48000 : 48000;
  const minOverhead = overheadBytes(container, duration, bottom.fps, audioCodec ? { sampleRate: minAudioSr, codec: audioCodec } : null);
  const minVideoBytes = (bpp.floor * bottom.width * bottom.height * bottom.fps * duration) / 8;
  const minimumBytes = Math.ceil((minOverhead + (minAudioBps * duration) / 8 + minVideoBytes) / TUNING.goalFill);

  if (probe.sizeBytes <= targetBytes && !needsChange) {
    reasons.push(`Already ${formatBytes(probe.sizeBytes)}, under the ${formatBytes(targetBytes, { round: 'nearest' })} target: returned untouched.`);
    return {
      ...base,
      mode: 'passthrough',
      container: container,
      budget: { targetBytes, goalBytes: targetBytes, overheadBytes: 0, audioBytes: 0, videoBytes: 0 },
      spec: null,
      ladder: [],
      rungIndex: -1,
      minimumBytes: Math.min(minimumBytes, probe.sizeBytes),
      reasons,
      warnings,
    };
  }
  warnings.push(...codecWarnings);
  if (v.hdr) warnings.push('HDR source: colours are converted to standard range and may look less vivid.');

  // 2. Audio: copy the source when it's already the right codec and cheap enough, else encode.
  const goalBytes = Math.floor(targetBytes * TUNING.goalFill);
  let audio: EncodeAudio | null = null;
  const a = probe.audio;
  if (hasAudio && a && audioCodec) {
    const provisionalOverhead = overheadBytes(container, duration, ladderDims[0]!.fps, { sampleRate: 48000, codec: audioCodec });
    const totalBps = ((goalBytes - provisionalOverhead) * 8) / duration;
    const channels = Math.min(Math.max(a.channels, 1), 2);
    let bitrate = pickAudioBitrate(totalBps, a.bitrate, channels);
    const copyable =
      trim === null &&
      a.codec === audioCodec &&
      a.channels <= 2 &&
      a.bitrate !== null &&
      a.bitrate <= bitrate * 1.05 &&
      capabilities.audioCopy.includes(a.codec);
    if (copyable) {
      bitrate = a.bitrate!;
      reasons.push(`Audio: source ${audioCodec.toUpperCase()} at ${formatBitrate(bitrate)} copied unchanged.`);
    } else {
      reasons.push(`Audio: ${audioCodec.toUpperCase()} ${formatBitrate(bitrate)} (${Math.round(TUNING.audioShare * 100)}% of the budget at most).`);
    }
    const sampleRate = audioCodec === 'opus' ? 48000 : a.sampleRate === 44100 || a.sampleRate === 48000 ? a.sampleRate : 48000;
    audio = { codec: audioCodec, copy: copyable, bitrate, channels: copyable ? a.channels : channels, sampleRate: copyable ? a.sampleRate : sampleRate };
  } else if (opts.mute && probe.audio) {
    reasons.push('Audio: removed (mute).');
  } else {
    reasons.push('Audio: none in the source.');
  }
  // 3. Walk the ladder: first rung whose bpp reaches the codec's target wins.
  const ladderFor = (au: EncodeAudio | null): Rung[] => {
    const auBytes = au ? Math.ceil((au.bitrate * duration) / 8) : 0;
    return ladderDims.map((d) => {
      const oh = overheadBytes(container, duration, d.fps, au ? { sampleRate: au.sampleRate, codec: au.codec } : null);
      const videoBps = ((goalBytes - oh - auBytes) * 8) / duration;
      return { ...d, bpp: videoBps / (d.width * d.height * d.fps) };
    });
  };
  let ladder = ladderFor(audio);
  // If even the bottom rung starves, give the video the audio's share before refusing.
  if (audio && ladder.at(-1)!.bpp < bpp.target && audio.bitrate > minAudioBps) {
    const lean: EncodeAudio = { ...audio, copy: false, bitrate: minAudioBps, channels: Math.min(audio.channels, 2), sampleRate: audio.codec === 'opus' ? 48000 : audio.sampleRate };
    const leanLadder = ladderFor(lean);
    if (ladder.findIndex((r) => r.bpp >= bpp.target) === -1) {
      audio = lean;
      ladder = leanLadder;
      reasons[reasons.length - 1] = `Audio: ${lean.codec.toUpperCase()} ${formatBitrate(lean.bitrate)} (the minimum, to leave room for the picture).`;
    }
  }
  const audioBytes = audio ? Math.ceil((audio.bitrate * duration) / 8) : 0;
  let idx = ladder.findIndex((r) => r.bpp >= bpp.target);
  if (idx === -1) idx = ladder.length - 1;
  const chosen = ladder[idx]!;
  const overhead = overheadBytes(container, duration, chosen.fps, audio ? { sampleRate: audio.sampleRate, codec: audio.codec } : null);
  let videoBytes = goalBytes - overhead - audioBytes;
  // Ceiling: past maxBpp (or the source's own bitrate) more bits buy nothing, so aim lower.
  const srcVideoBps = v.bitrate ?? (probe.bitrate ? probe.bitrate - (probe.audio?.bitrate ?? 0) : null);
  const capBps = Math.min(
    TUNING.maxBpp * TUNING.codecEfficiency[codec] * chosen.width * chosen.height * chosen.fps,
    srcVideoBps && srcVideoBps > 0 ? srcVideoBps * TUNING.maxSourceBitrateFactor : Infinity,
  );
  let cappedGoal = goalBytes;
  if ((videoBytes * 8) / duration > capBps) {
    videoBytes = Math.floor((capBps * duration) / 8);
    cappedGoal = videoBytes + overhead + audioBytes;
    reasons.push(`Capped at ${formatBitrate(capBps)}: more bits wouldn't look any better, so the file comes out under the target.`);
  }
  const budget: Budget = { targetBytes, goalBytes: cappedGoal, overheadBytes: overhead, audioBytes, videoBytes: Math.max(0, videoBytes) };

  if (targetBytes < minimumBytes || chosen.bpp < bpp.floor || videoBytes <= 0) {
    reasons.push(
      `The smallest Snugclip can make is ${formatBytes(minimumBytes, { round: 'ceil' })} ` +
        `(${bottom.width}x${bottom.height} at ${round2(bottom.fps)} fps${hasAudio ? `, ${formatBitrate(minAudioBps)} audio` : ''}).`,
    );
    return { ...base, mode: 'impossible', budget, spec: null, ladder, rungIndex: idx, minimumBytes, reasons, warnings };
  }

  const videoBps = Math.floor((videoBytes * 8) / duration);
  const video: EncodeVideo = {
    codec,
    width: chosen.width,
    height: chosen.height,
    fps: chosen.fps,
    bitrate: videoBps,
    maxBitrate: Math.floor(videoBps * TUNING.maxrateFactor),
    bufferSize: Math.floor(videoBps * TUNING.bufsizeSeconds),
  };
  const spec: EncodeSpec = { container, video, audio, trim };
  const srcDesc = `${v.width}x${v.height} at ${round2(v.fps)} fps`;
  if (chosen.width === v.width && chosen.height === v.height && Math.abs(chosen.fps - v.fps) < 0.01) {
    reasons.push(`Video: keeps ${srcDesc}; ${formatBitrate(videoBps)} gives ${chosen.bpp.toFixed(3)} bits per pixel.`);
  } else {
    reasons.push(
      `Video: ${srcDesc} → ${chosen.width}x${chosen.height} at ${round2(chosen.fps)} fps so ${formatBitrate(videoBps)} ` +
        `gives ${chosen.bpp.toFixed(3)} bits per pixel (aim ≥ ${bpp.target.toFixed(3)} for ${codec.toUpperCase()}).`,
    );
  }
  if (chosen.bpp < bpp.target) warnings.push('Tight budget: expect a soft picture. Trimming or muting would help.');
  if (probe.sizeBytes <= targetBytes) reasons.push('Already under the target, re-encoding because an option asked for a change.');
  return { ...base, mode: 'encode', budget, spec, ladder, rungIndex: idx, minimumBytes, reasons, warnings };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Video bitrate (bits/s) that gives a rung its floor bpp. */
export function floorBitrate(r: Omit<Rung, 'bpp'>, codec: VideoCodec): number {
  return bppFor(codec).floor * r.width * r.height * r.fps;
}

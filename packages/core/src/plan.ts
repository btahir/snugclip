// The planner (PLAN §4.1–4.6): a pure function from (probe, target, options, capabilities) to a
// Plan. No I/O, no clock, no randomness, so the web app, CLI and MCP produce the same plan for
// the same probe.
import { SnugclipError } from './errors.js';
import { getPreset } from './presets.js';
import { formatBitrate, formatSize } from './size.js';
import { TUNING } from './tuning.js';
import type {
  AudioCodecId,
  CodecChoice,
  ContainerId,
  EngineCapabilities,
  Options,
  Plan,
  PlanAudio,
  PlanVideo,
  Probe,
  Rung,
  Target,
  TrimRange,
  VideoCodecId,
  Warning,
} from './types.js';

export const DEFAULT_OPTIONS: Options = { codec: 'compatible', keepFps: false, mute: false, reencode: false };

const CODECS: readonly CodecChoice[] = ['compatible', 'smaller', 'h264', 'hevc', 'av1', 'vp9'];

/** Fills defaults and validates. Throws E_ARGS / E_TRIM. */
export function normalizeOptions(o: Partial<Options> = {}): Options {
  const out: Options = { ...DEFAULT_OPTIONS };
  if (o.codec !== undefined) {
    if (!CODECS.includes(o.codec)) throw new SnugclipError('E_ARGS', `Unknown codec "${String(o.codec)}". Use one of: ${CODECS.join(', ')}.`);
    out.codec = o.codec;
  }
  if (o.maxShortSide !== undefined && o.maxShortSide !== null) {
    if (!(Number.isInteger(o.maxShortSide) && o.maxShortSide >= 64 && o.maxShortSide <= 8640)) {
      throw new SnugclipError('E_ARGS', `Max height must be a whole number of pixels from 64 to 8640 (got ${o.maxShortSide}).`);
    }
    out.maxShortSide = o.maxShortSide;
  }
  if (o.fpsCap !== undefined && o.fpsCap !== null) {
    if (!(o.fpsCap > 0 && o.fpsCap <= 240)) throw new SnugclipError('E_ARGS', `fps must be between 1 and 240 (got ${o.fpsCap}).`);
    out.fpsCap = o.fpsCap;
  }
  if (o.trim) {
    const { startSec, endSec } = o.trim;
    if (!(Number.isFinite(startSec) && startSec >= 0 && Number.isFinite(endSec) && endSec > startSec)) {
      throw new SnugclipError('E_TRIM', `Trim end (${endSec}) must be after trim start (${startSec}), both in seconds.`);
    }
    out.trim = { startSec, endSec };
  }
  if (o.maxAttempts !== undefined) {
    if (!(Number.isInteger(o.maxAttempts) && o.maxAttempts >= 1 && o.maxAttempts <= TUNING.maxAttempts.limit)) {
      throw new SnugclipError('E_ARGS', `Attempts must be 1–${TUNING.maxAttempts.limit} (got ${o.maxAttempts}).`);
    }
    out.maxAttempts = o.maxAttempts;
  }
  if (o.qualityFrames !== undefined) {
    if (!(Number.isInteger(o.qualityFrames) && o.qualityFrames >= 1 && o.qualityFrames <= 30)) {
      throw new SnugclipError('E_ARGS', `Quality frames must be 1–30 (got ${o.qualityFrames}).`);
    }
    out.qualityFrames = o.qualityFrames;
  }
  out.keepFps = !!o.keepFps;
  out.mute = !!o.mute;
  out.reencode = !!o.reencode;
  return out;
}

export function marginFor(caps: EngineCapabilities, codec: VideoCodecId): number {
  return caps.marginByCodec?.[codec] ?? caps.initialMargin;
}

export function bppThresholds(codec: VideoCodecId): { good: number; floor: number; ceiling: number } {
  const k = TUNING.k[codec];
  return { good: TUNING.bppGood * k, floor: TUNING.bppFloor * k, ceiling: TUNING.bppCeiling * k };
}

/** Picks the output video codec and container. Throws E_UNSUPPORTED_ENCODER when nothing fits. */
export function chooseCodec(choice: CodecChoice, caps: EngineCapabilities): { codec: VideoCodecId; container: ContainerId; warnings: Warning[] } {
  const has = (c: VideoCodecId) => caps.videoCodecs.includes(c) && caps.containers.includes(c === 'vp9' ? 'webm' : 'mp4');
  const container = (c: VideoCodecId): ContainerId => (c === 'vp9' ? 'webm' : 'mp4');
  const warnings: Warning[] = [];
  if (choice === 'compatible') {
    if (has('h264')) return { codec: 'h264', container: 'mp4', warnings };
    const alt = (['vp9', 'av1', 'hevc'] as const).find(has);
    if (!alt) throw new SnugclipError('E_UNSUPPORTED_ENCODER', 'No H.264 (or other) video encoder is available here.', { hint: 'Install a full ffmpeg build, or use Chrome, Edge, Firefox or Safari 26+.' });
    warnings.push({ code: 'compatible-unavailable', message: `H.264 can't be encoded here, so Snugclip used ${alt.toUpperCase()}. Some players may not open it.` });
    return { codec: alt, container: container(alt), warnings };
  }
  if (choice === 'smaller') {
    const c = (['av1', 'hevc'] as const).find(has);
    if (c) {
      warnings.push({ code: 'smaller-compat', message: `${c === 'av1' ? 'AV1' : 'HEVC'} makes smaller files, but older phones and some apps can't play it.` });
      return { codec: c, container: 'mp4', warnings };
    }
    const fb = (['h264', 'vp9'] as const).find(has);
    if (!fb) throw new SnugclipError('E_UNSUPPORTED_ENCODER', 'No video encoder is available here.');
    warnings.push({ code: 'smaller-unavailable', message: `Neither AV1 nor HEVC can be encoded here, so Snugclip used ${fb.toUpperCase()}.` });
    return { codec: fb, container: container(fb), warnings };
  }
  if (!has(choice)) {
    throw new SnugclipError('E_UNSUPPORTED_ENCODER', `${choice.toUpperCase()} can't be encoded here.`, { details: { available: caps.videoCodecs } });
  }
  return { codec: choice, container: container(choice), warnings };
}

/** Container overhead (PLAN §4.1). */
export function overheadBytes(container: ContainerId, durationSec: number, fps: number, audio: { codec: AudioCodecId; sampleRate: number } | null): number {
  const m = TUNING.overhead[container];
  const nv = Math.ceil(durationSec * fps);
  const na = !audio ? 0 : audio.codec === 'aac' ? Math.ceil((durationSec * audio.sampleRate) / 1024) : Math.ceil(durationSec * 50);
  return m.fixed + m.perVideo * nv + m.perAudio * na;
}

const roundEven = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output dims for a short side on display dims; both even; never upscales. */
export function dimsForShortSide(displayW: number, displayH: number, shortSide: number): { width: number; height: number } {
  const srcShort = Math.min(displayW, displayH);
  const s = Math.min(shortSide, srcShort);
  const long = (Math.max(displayW, displayH) * s) / srcShort;
  return displayW >= displayH ? { width: roundEven(long), height: roundEven(s) } : { width: roundEven(s), height: roundEven(long) };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** fps after the 60→30 rule (59.94→29.97, 50→25, anything else above 30.5 → 30). */
export function droppedFps(f0: number): number {
  if (f0 <= TUNING.fpsDropAbove) return f0;
  const half = round3(f0 / 2);
  return half <= TUNING.fpsDropAbove ? half : 30;
}

function sourceFps(probe: Probe): number {
  const f = probe.video?.fps ?? 0;
  return Number.isFinite(f) && f > 0 ? round3(f) : 30;
}

export interface LadderEntry {
  shortSide: number;
  width: number;
  height: number;
  fps: number;
}

/** Candidate rungs, best first (PLAN §4.4). */
export function buildRungs(probe: Probe, options: Options, codec: VideoCodecId, caps: EngineCapabilities, presetMaxShortSide?: number): LadderEntry[] {
  const v = probe.video!;
  const W = v.displayWidth;
  const H = v.displayHeight;
  const srcShort = Math.min(W, H);
  let f0 = sourceFps(probe);
  if (!options.keepFps) f0 = Math.min(f0, TUNING.maxAutoFps);
  if (options.fpsCap !== undefined) f0 = Math.min(f0, options.fpsCap);
  const f = options.keepFps ? f0 : droppedFps(f0);
  const top = Math.min(srcShort, options.maxShortSide ?? Infinity, presetMaxShortSide ?? Infinity, caps.maxEncodeShortSide[codec] ?? Infinity);
  const entry = (s: number, fps: number): LadderEntry => ({ shortSide: Math.min(s, srcShort), ...dimsForShortSide(W, H, s), fps });
  const out: LadderEntry[] = [entry(top, f0)];
  if (f < f0) out.push(entry(top, f));
  if (srcShort >= 240) for (const r of TUNING.rungs) if (r < top) out.push(entry(r, f));
  if (!options.keepFps) {
    const bottom = out.at(-1)!;
    for (const s of TUNING.bottomFpsSteps) if (s < bottom.fps) out.push({ ...bottom, fps: s });
  }
  return out;
}

function audioSampleRate(codec: AudioCodecId, src: number): number {
  if (codec === 'opus') return 48000;
  return src === 44100 || src === 48000 ? src : 48000;
}

/** Largest ladder rung ≤ x, never below the last rung. */
function rungAtOrBelow(ladder: readonly number[], x: number): number {
  return ladder.find((r) => r <= x) ?? ladder.at(-1)!;
}
/** Smallest ladder rung ≥ x (the top rung if x is above all). */
function rungAtOrAbove(ladder: readonly number[], x: number): number {
  const asc = [...ladder].sort((a, b) => a - b);
  return asc.find((r) => r >= x) ?? asc.at(-1)!;
}

/** Audio selection (PLAN §4.2). `btotKbps` = (S − O)·8/D/1000. */
export function chooseAudio(
  probe: Probe,
  options: Options,
  codec: AudioCodecId,
  durationSec: number,
  btotKbps: number,
  caps: EngineCapabilities,
  trim: TrimRange | undefined,
): PlanAudio {
  const a = probe.audio;
  if (!a || options.mute) return { mode: 'none', bytes: 0 };
  const ladder = TUNING.audioLadder[codec];
  let abr = rungAtOrBelow(ladder, TUNING.audioShare * btotKbps);
  const srcKbps = a.bitrate ? a.bitrate / 1000 : undefined;
  if (srcKbps !== undefined) abr = Math.min(abr, rungAtOrAbove(ladder, srcKbps));
  const containerOk = codec === 'aac' ? a.codec === 'aac' : a.codec === 'opus';
  if (containerOk && srcKbps !== undefined && srcKbps <= TUNING.copyFactor * abr && a.channels <= 2 && (!trim || caps.audioCopyWithTrim)) {
    return {
      mode: 'copy',
      codec,
      bitrate: Math.round(a.bitrate!),
      channels: a.channels <= 1 ? 1 : 2,
      sampleRate: a.sampleRate,
      bytes: Math.ceil((a.bitrate! * durationSec) / 8),
    };
  }
  return encodeAudio(codec, abr, a.channels, a.sampleRate, durationSec, caps);
}

/**
 * Encode config for a desired rung. When the engine rejects it (caps.canEncodeAudio), try mono at
 * the same rate, then step up the ladder until something encodes. Null if nothing does.
 */
function encodeAudio(codec: AudioCodecId, kbps: number, srcChannels: number, srcRate: number, durationSec: number, caps?: EngineCapabilities): PlanAudio {
  const sampleRate = audioSampleRate(codec, srcRate);
  const make = (k: number, channels: 1 | 2): PlanAudio => ({
    mode: 'encode',
    codec,
    bitrate: k * 1000,
    channels,
    sampleRate,
    bytes: Math.ceil(((k * 1000 * durationSec) / 8) * TUNING.audioPad),
  });
  const preferred: 1 | 2 = srcChannels <= 1 || kbps <= TUNING.monoAtOrBelow[codec] ? 1 : 2;
  const ok = (k: number, ch: 1 | 2) => !caps?.canEncodeAudio || caps.canEncodeAudio(codec, k * 1000, ch, sampleRate);
  if (ok(kbps, preferred)) return make(kbps, preferred);
  if (preferred === 2 && ok(kbps, 1)) return make(kbps, 1);
  const up = [...TUNING.audioLadder[codec]].reverse().filter((k) => k > kbps);
  for (const k of up) {
    if (ok(k, 1)) return make(k, 1);
    if (srcChannels > 1 && ok(k, 2)) return make(k, 2);
  }
  return make(kbps, preferred); // nothing validated: let the engine report the real error
}

function minAudioBytes(codec: AudioCodecId, durationSec: number, srcRate: number, caps?: EngineCapabilities): number {
  return encodeAudio(codec, TUNING.audioLadder[codec].at(-1)!, 1, srcRate, durationSec, caps).bytes;
}

/** Resolves and validates a trim against the source. Undefined when it covers the whole clip. */
export function resolveTrim(trim: TrimRange | undefined, durationSec: number): TrimRange | undefined {
  if (!trim) return undefined;
  if (trim.startSec >= durationSec) {
    throw new SnugclipError('E_TRIM', `Trim starts at ${trim.startSec} s but the clip is only ${durationSec.toFixed(2)} s long.`);
  }
  const endSec = Math.min(trim.endSec, durationSec);
  if (endSec - trim.startSec < 0.1) throw new SnugclipError('E_TRIM', 'Trim range is shorter than 0.1 s.');
  if (trim.startSec <= 0.001 && endSec >= durationSec - 0.001) return undefined;
  return { startSec: trim.startSec, endSec };
}

const CHAT_PRESETS = /^(discord|whatsapp|slack|telegram|imessage)/;

function checkProbe(probe: Probe): void {
  if (!probe.video) throw new SnugclipError('E_UNSUPPORTED', 'This file has no video track.', { hint: 'Snugclip compresses videos (MP4, MOV, M4V, WebM, MKV).' });
  if (!probe.video.decodable) {
    throw new SnugclipError('E_UNSUPPORTED', `This file uses ${probe.video.codec}, which can't be decoded here.`, {
      hint: 'Snugclip handles MP4, MOV, M4V, WebM and MKV with H.264, HEVC, VP9 or AV1. The CLI (ffmpeg) decodes more.',
    });
  }
  if (!(probe.durationSec > 0) || !Number.isFinite(probe.durationSec)) throw new SnugclipError('E_UNSUPPORTED', "Couldn't read this video's duration.");
  if (!(probe.video.displayWidth > 0 && probe.video.displayHeight > 0)) throw new SnugclipError('E_UNSUPPORTED', "Couldn't read this video's dimensions.");
}

interface Budgeted {
  entries: LadderEntry[];
  rungs: Rung[];
}

/**
 * Minimum achievable size (PLAN §4.5): lowest rung, min fps, floor bpp, minimum audio,
 * divided by (1 − margin).
 */
export function minimumBytes(probe: Probe, options: Partial<Options>, caps: EngineCapabilities, target?: Target): number {
  checkProbe(probe);
  const opts = normalizeOptions(options);
  const trim = resolveTrim(opts.trim, probe.durationSec);
  const D = trim ? trim.endSec - trim.startSec : probe.durationSec;
  const { codec, container } = chooseCodec(opts.codec, caps);
  const preset = target?.presetId ? getPreset(target.presetId) : undefined;
  const entries = buildRungs(probe, opts, codec, caps, preset?.maxShortSide);
  return minimumFor(probe, opts, codec, container, entries, D, marginFor(caps, codec), caps);
}

function minimumFor(probe: Probe, opts: Options, codec: VideoCodecId, container: ContainerId, entries: LadderEntry[], D: number, m: number, caps?: EngineCapabilities): number {
  const bottom = entries.at(-1)!;
  const fmin = opts.keepFps ? bottom.fps : Math.min(bottom.fps, TUNING.minFps);
  const audioCodec: AudioCodecId = container === 'webm' ? 'opus' : 'aac';
  const hasAudio = !!probe.audio && !opts.mute;
  const aMin = hasAudio ? minAudioBytes(audioCodec, D, probe.audio!.sampleRate, caps) : 0;
  const oh = overheadBytes(container, D, fmin, hasAudio ? { codec: audioCodec, sampleRate: audioSampleRate(audioCodec, probe.audio!.sampleRate) } : null);
  const vMin = (bppThresholds(codec).floor * bottom.width * bottom.height * fmin * D) / 8;
  return Math.ceil((oh + aMin + vMin) / (1 - m));
}

/** Plans a compression (PLAN §4). Throws E_UNSUPPORTED / E_ARGS / E_TRIM / E_UNSUPPORTED_ENCODER. */
export function plan(probe: Probe, target: Target, options: Partial<Options>, caps: EngineCapabilities): Plan {
  checkProbe(probe);
  const T = Math.floor(target.bytes);
  if (!(T > 0)) throw new SnugclipError('E_ARGS', `Target must be a positive number of bytes (got ${target.bytes}).`);
  const opts = normalizeOptions(options);
  const v = probe.video!;
  const trim = resolveTrim(opts.trim, probe.durationSec);
  const D = trim ? trim.endSec - trim.startSec : probe.durationSec;
  const preset = target.presetId ? getPreset(target.presetId) : undefined;
  const srcShort = Math.min(v.displayWidth, v.displayHeight);
  const srcFps = sourceFps(probe);
  const warnings: Warning[] = [];
  const reasons: string[] = [];

  let { codec, container, warnings: codecWarnings } = chooseCodec(opts.codec, caps);
  let audioCodec: AudioCodecId = container === 'webm' ? 'opus' : 'aac';
  let m = marginFor(caps, codec);
  let entries = buildRungs(probe, opts, codec, caps, preset?.maxShortSide);
  const minBytes = minimumFor(probe, opts, codec, container, entries, D, m, caps);

  // Pass-through (§4.6)
  const passThrough =
    probe.sizeBytes <= T &&
    !opts.reencode &&
    !trim &&
    !(opts.mute && probe.audio) &&
    opts.codec === 'compatible' &&
    (opts.maxShortSide === undefined || opts.maxShortSide >= srcShort) &&
    (opts.fpsCap === undefined || opts.fpsCap >= srcFps - 0.01);
  if (passThrough) {
    if (v.codec !== 'h264' && preset && CHAT_PRESETS.test(preset.id)) {
      warnings.push({ code: 'codec-compat', message: `This file is ${v.codec.toUpperCase()}; ${preset.label} may not preview it. Re-encode to H.264 if people can't play it.` });
    }
    if (/^(mkv|matroska)/.test(probe.container)) {
      warnings.push({ code: 'container-preview', message: 'MKV files often have no inline preview in chat apps.' });
    }
    if (preset?.maxShortSide && srcShort > preset.maxShortSide) {
      warnings.push({ code: 'platform-will-downscale', message: `${preset.label} will downscale this to ${preset.maxShortSide}p anyway.` });
    }
    reasons.push(`Already ${formatSize(probe.sizeBytes)}, under the ${target.label} limit: returned untouched.`);
    return {
      version: 1,
      feasible: true,
      passThrough: true,
      targetBytes: T,
      marginBytes: 0,
      overheadBytes: 0,
      minimumBytes: minBytes,
      durationSec: D,
      container: probe.container === 'webm' ? 'webm' : 'mp4',
      video: null,
      audio: { mode: 'none', bytes: 0 },
      rungs: [],
      warnings,
      reasons,
    };
  }
  warnings.push(...codecWarnings);

  // Firefox without an AAC encoder: copy the source AAC if allowed, else fall back to WebM/Opus.
  const needsAacEncode = () => {
    if (container !== 'mp4' || !probe.audio || opts.mute) return false;
    if (caps.audioCodecs.includes('aac')) return false;
    const S = Math.floor(T * (1 - m));
    const btot = ((S - overheadBytes(container, D, entries[0]!.fps, { codec: 'aac', sampleRate: 48000 })) * 8) / D / 1000;
    return chooseAudio(probe, opts, 'aac', D, btot, caps, trim).mode !== 'copy';
  };
  if (needsAacEncode()) {
    if (caps.videoCodecs.includes('vp9') && caps.audioCodecs.includes('opus') && caps.containers.includes('webm')) {
      codec = 'vp9';
      container = 'webm';
      audioCodec = 'opus';
      m = marginFor(caps, codec);
      entries = buildRungs(probe, opts, codec, caps, preset?.maxShortSide);
      warnings.push({ code: 'aac-unavailable', message: 'This browser can\'t encode AAC audio, so Snugclip made a WebM (VP9 + Opus) instead.' });
    } else {
      throw new SnugclipError('E_UNSUPPORTED_ENCODER', "This browser can't encode AAC audio.", { hint: 'Mute the clip, or use Chrome or Edge.' });
    }
  }
  if (v.hdr) warnings.push({ code: 'hdr-to-sdr', message: 'HDR source: colours are converted to standard range and may shift slightly.' });

  // Budget (§4.1) and audio (§4.2)
  const S = Math.floor(T * (1 - m));
  const hasAudio = !!probe.audio && !opts.mute;
  const audioSr = hasAudio ? audioSampleRate(audioCodec, probe.audio!.sampleRate) : 0;
  const O0 = overheadBytes(container, D, entries[0]!.fps, hasAudio ? { codec: audioCodec, sampleRate: audioSr } : null);
  let audio = chooseAudio(probe, opts, audioCodec, D, ((S - O0) * 8) / D / 1000, caps, trim);

  const { good, floor, ceiling } = bppThresholds(codec);
  const budget = (a: PlanAudio): Budgeted => ({
    entries,
    rungs: entries.map((e) => {
      const oh = overheadBytes(container, D, e.fps, a.mode === 'none' ? null : { codec: a.codec!, sampleRate: a.sampleRate! });
      const vbr = ((S - oh - a.bytes) * 8) / D;
      return { ...e, bpp: vbr / (e.width * e.height * e.fps) };
    }),
  });
  const select = (b: Budgeted): number => {
    let idx = b.rungs.findIndex((r) => r.bpp >= good);
    if (idx === -1) idx = b.rungs.length - 1;
    while (idx < b.rungs.length - 1) {
      const r = b.rungs[idx]!;
      if (caps.canEncode(codec, r.width, r.height, r.bpp * r.width * r.height * r.fps)) break;
      idx++;
    }
    return idx;
  };
  let b = budget(audio);
  let idx = select(b);
  // Give the picture the audio's share before refusing (only ever lowers audio to the minimum).
  if (b.rungs[idx]!.bpp < floor && audio.mode !== 'none') {
    const lean = encodeAudio(audioCodec, TUNING.audioLadder[audioCodec].at(-1)!, probe.audio!.channels, probe.audio!.sampleRate, D, caps);
    if (lean.bytes < audio.bytes) {
      audio = lean;
      b = budget(audio);
      idx = select(b);
      reasons.push('Audio cut to the minimum to leave room for the picture.');
    }
  }
  const rungs = b.rungs;
  const chosen = rungs[idx]!;
  const oh = overheadBytes(container, D, chosen.fps, audio.mode === 'none' ? null : { codec: audio.codec!, sampleRate: audio.sampleRate! });
  const vbr0 = ((S - oh - audio.bytes) * 8) / D;
  const feasible = T >= minBytes && vbr0 > 0;

  if (audio.mode === 'copy') reasons.push(`Audio: source ${audioCodec.toUpperCase()} at ${formatBitrate(audio.bitrate!)} copied unchanged.`);
  else if (audio.mode === 'encode') reasons.push(`Audio: ${audioCodec.toUpperCase()} ${formatBitrate(audio.bitrate!)}${audio.channels === 1 ? ' mono' : ''}.`);
  else reasons.push(probe.audio ? 'Audio: removed (mute).' : 'Audio: none in the source.');

  const base = {
    version: 1 as const,
    passThrough: false,
    targetBytes: T,
    marginBytes: T - S,
    overheadBytes: oh,
    minimumBytes: minBytes,
    durationSec: D,
    container,
    audio,
    rungs,
    ...(trim ? { trim } : {}),
    warnings,
    reasons,
  };
  if (!feasible) {
    const bottom = entries.at(-1)!;
    reasons.push(
      `Too small: the smallest Snugclip can make is ${formatSize(minBytes, { round: 'ceil' })} ` +
        `(${bottom.width}x${bottom.height} at ${opts.keepFps ? bottom.fps : Math.min(bottom.fps, TUNING.minFps)} fps). Trim it, mute it, or pick a bigger limit.`,
    );
    return { ...base, feasible: false, video: null };
  }

  // Quality ceiling (§4.4)
  let vbr = Math.floor(vbr0);
  let capped: PlanVideo['capped'];
  const ceilBps = ceiling * chosen.width * chosen.height * chosen.fps;
  const srcVideoBps = v.bitrate ?? (probe.sizeBytes * 8) / probe.durationSec - (probe.audio?.bitrate ?? 0);
  const srcCap = srcVideoBps > 0 ? srcVideoBps * TUNING.sourceBitrateFactor : Infinity;
  if (ceilBps < vbr && ceilBps <= srcCap) {
    vbr = Math.floor(ceilBps);
    capped = 'quality-ceiling';
  } else if (srcCap < vbr) {
    vbr = Math.floor(srcCap);
    capped = 'source-bitrate';
  }
  const bpp = vbr / (chosen.width * chosen.height * chosen.fps);
  const tier: 'A' | 'B' = bpp / TUNING.k[codec] >= TUNING.bppGood - 1e-9 ? 'A' : 'B';
  const video: PlanVideo = {
    codec,
    width: chosen.width,
    height: chosen.height,
    fps: chosen.fps,
    bitrate: vbr,
    bpp: Math.round(bpp * 10000) / 10000,
    bppTier: tier,
    keyframeIntervalSec: TUNING.keyframeSec[tier],
    rungIndex: idx,
    ...(capped ? { capped } : {}),
  };
  const same = chosen.width === v.displayWidth && chosen.height === v.displayHeight && Math.abs(chosen.fps - srcFps) < 0.01;
  reasons.push(
    same
      ? `Video: keeps ${v.displayWidth}x${v.displayHeight} at ${srcFps} fps, ${codec.toUpperCase()} ${formatBitrate(vbr)} (${video.bpp} bits per pixel).`
      : `Video: ${v.displayWidth}x${v.displayHeight} at ${srcFps} fps → ${chosen.width}x${chosen.height} at ${chosen.fps} fps, ${codec.toUpperCase()} ${formatBitrate(vbr)} ` +
          `(${video.bpp} bits per pixel; aim ≥ ${round3(good)}).`,
  );
  if (capped === 'quality-ceiling') reasons.push(`Capped at ${formatBitrate(vbr)}: more bits wouldn't look better, so the file lands under the limit.`);
  if (capped === 'source-bitrate') reasons.push(`Capped near the source's own bitrate (${formatBitrate(vbr)}): re-encoding can't add detail.`);
  if (tier === 'B') warnings.push({ code: 'tight-budget', message: 'Tight budget: expect a soft picture. Trimming or muting would help.' });
  return { ...base, feasible: true, video };
}

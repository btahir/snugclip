// Shared data types. Everything here is plain, JSON-serialisable data so it can cross a
// Web Worker boundary, go into a job file, or be printed by the CLI/MCP unchanged.

/** Video codecs Snugclip can produce. */
export type VideoCodec = 'h264' | 'hevc' | 'av1' | 'vp9';
/** Audio codecs Snugclip can produce. */
export type AudioCodec = 'aac' | 'opus';
/** Output containers. */
export type Container = 'mp4' | 'webm';

/**
 * User-facing codec choice.
 * - `compatible`: H.264 + AAC in MP4 (default; plays everywhere).
 * - `smaller`: AV1 where it can be encoded, otherwise HEVC (smaller files, weaker playback support).
 * - an explicit codec forces that codec (CLI/MCP power users).
 */
export type CodecChoice = 'compatible' | 'smaller' | VideoCodec;

/** What an input file contains, as reported by an engine's probe. */
export interface Probe {
  /** Container/format name in lower case (mp4, mov, webm, matroska, ...). */
  container: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Duration in seconds. */
  durationSec: number;
  /** Overall bitrate in bits per second, if known. */
  bitrate: number | null;
  video: ProbeVideo | null;
  audio: ProbeAudio | null;
}

export interface ProbeVideo {
  /** Source codec name, lower case (h264, hevc, vp9, av1, prores, ...). */
  codec: string;
  /** Coded width/height in pixels, before rotation. */
  codedWidth: number;
  codedHeight: number;
  /** Clockwise rotation from the display matrix / rotate tag. */
  rotation: 0 | 90 | 180 | 270;
  /** Display width/height after rotation (what the viewer sees). */
  width: number;
  height: number;
  /** Average frame rate in frames per second. */
  fps: number;
  /** Video stream bitrate in bits per second, if known. */
  bitrate: number | null;
  /** Number of frames, if known. */
  frameCount: number | null;
  /** True for PQ/HLG transfer characteristics (HDR10, HLG, Dolby Vision base layers). */
  hdr: boolean;
  /** Pixel format / bit depth hint, if known (e.g. yuv420p10le). */
  pixelFormat: string | null;
}

export interface ProbeAudio {
  codec: string;
  channels: number;
  sampleRate: number;
  /** Audio stream bitrate in bits per second, if known. */
  bitrate: number | null;
}

/** Where the file is going. Sizes are always bytes. */
export interface Target {
  bytes: number;
  /** Preset id when the target came from a preset (e.g. `discord-free`). */
  presetId?: string;
  /** Human label, e.g. "Discord (free)" or "10 MB". */
  label?: string;
}

/** Frame rate policy. `auto` caps at 60 and drops 60→30 when the budget is tight. */
export type FpsPolicy = 'auto' | 'keep' | number;

export interface TrimRange {
  /** Start in seconds from the beginning of the source. */
  start: number;
  /** End in seconds from the beginning of the source (exclusive). */
  end: number;
}

/** User options. Every field is optional; the defaults just work. */
export interface Options {
  codec?: CodecChoice;
  /**
   * Cap on the output's shorter side, i.e. the "p" number: 720 means 720p in either
   * orientation (1280x720 landscape, 720x1280 portrait). Never upscales.
   */
  maxHeight?: number | null;
  fps?: FpsPolicy;
  trim?: TrimRange | null;
  mute?: boolean;
  /** Re-encode even when the file is already under the target (default: pass through). */
  reencode?: boolean;
}

/** Fully resolved options (defaults applied). */
export interface ResolvedOptions {
  codec: CodecChoice;
  maxHeight: number | null;
  fps: FpsPolicy;
  trim: TrimRange | null;
  mute: boolean;
  reencode: boolean;
}

/** What an engine can encode on this machine / browser. */
export interface Capabilities {
  video: VideoCodec[];
  audio: AudioCodec[];
  /** Audio codecs the engine can copy without re-encoding (stream copy). */
  audioCopy: string[];
  /**
   * How the engine controls rate. `two-pass` encoders land within a few percent of the
   * requested bitrate; `one-pass` encoders (WebCodecs, hardware) drift and benefit from
   * calibration samples.
   */
  rateControl: 'two-pass' | 'one-pass';
}

/** One encode, fully specified. This is what an Engine receives. */
export interface EncodeSpec {
  container: Container;
  video: EncodeVideo | null;
  audio: EncodeAudio | null;
  /** Source range to encode; null = whole file. */
  trim: TrimRange | null;
  /** True for short calibration samples (engines may use faster settings). */
  sample?: boolean;
}

export interface EncodeVideo {
  codec: VideoCodec;
  /** Output display width/height (even numbers). */
  width: number;
  height: number;
  fps: number;
  /** Requested average bitrate, bits per second. */
  bitrate: number;
  /** Peak bitrate cap for VBV (bits per second). */
  maxBitrate: number;
  /** VBV buffer size in bits. */
  bufferSize: number;
}

export interface EncodeAudio {
  codec: AudioCodec;
  /** True to stream-copy the source audio unchanged (bitrate is then the source's). */
  copy: boolean;
  bitrate: number;
  channels: number;
  sampleRate: number;
}

/** Byte budget breakdown for a plan. */
export interface Budget {
  targetBytes: number;
  /** Bytes we aim for (target × fill goal). Encodes may land anywhere ≤ target. */
  goalBytes: number;
  overheadBytes: number;
  audioBytes: number;
  videoBytes: number;
}

export type PlanMode = 'passthrough' | 'encode' | 'impossible';

/** A resolution/fps rung the planner considered. */
export interface Rung {
  width: number;
  height: number;
  fps: number;
  /** Bits per pixel per frame this rung would get from the video budget. */
  bpp: number;
}

export interface Plan {
  mode: PlanMode;
  target: Target;
  options: ResolvedOptions;
  /** Output duration in seconds (trim applied). */
  durationSec: number;
  /** Chosen video codec after resolving `compatible` / `smaller` against capabilities. */
  videoCodec: VideoCodec | null;
  audioCodec: AudioCodec | null;
  container: Container;
  budget: Budget;
  /** The encode to try first (null for passthrough / impossible). */
  spec: EncodeSpec | null;
  /** The ladder from the chosen rung downward, used by the fit loop when it drops rungs. */
  ladder: Rung[];
  /** Index into `ladder` of the chosen rung. */
  rungIndex: number;
  /** Smallest output Snugclip can make for this input with these options, in bytes. */
  minimumBytes: number;
  /** Why the plan is what it is, in plain words (for `snugclip plan`). */
  reasons: string[];
  warnings: string[];
}

export type AttemptKind = 'sample' | 'encode';

export interface Attempt {
  kind: AttemptKind;
  /** 1-based attempt number within its kind. */
  n: number;
  width: number;
  height: number;
  fps: number;
  requestedVideoBitrate: number;
  bytes: number;
  /** Measured video bitrate (bits/s) if the engine reported it, else estimated. */
  actualVideoBitrate: number;
  fits: boolean;
  /** Whether this attempt's output was kept as the result candidate. */
  kept: boolean;
  elapsedMs: number;
  note?: string;
}

export interface QualityMetrics {
  /** Mean SSIM (luma) over sampled frames, 0..1. */
  ssimMean: number;
  /** Worst SSIM over sampled frames. */
  ssimMin: number;
  /** Mean PSNR (luma) in dB; capped at 100 for identical frames. */
  psnrMean: number;
  /** Number of frames compared. */
  frames: number;
  /** Resolution the comparison ran at. */
  width: number;
  height: number;
}

export type QualityVerdict = 'great' | 'softer' | 'soft';

export interface QualityReport extends QualityMetrics {
  verdict: QualityVerdict;
  /** Plain-words label for the UI badge: "Looks great", "Softer, still clear", "Noticeably soft". */
  label: string;
}

export type Verdict = 'fits' | 'passthrough' | 'impossible' | 'unsupported' | 'failed' | 'cancelled';

export interface OutputInfo {
  path?: string;
  name?: string;
  bytes: number;
  container: Container | string;
  durationSec: number;
  video: { codec: string; width: number; height: number; fps: number; bitrate: number } | null;
  audio: { codec: string; bitrate: number; channels: number } | null;
}

/** The result of one compression, shared by the web app, CLI and MCP server. */
export interface Report {
  kind: 'snugclip.report';
  version: number;
  verdict: Verdict;
  /** True when an output exists and is ≤ target bytes (always true for fits/passthrough). */
  fits: boolean;
  input: { path?: string; name?: string; bytes: number; probe: Probe | null };
  target: Target;
  output: OutputInfo | null;
  plan: Plan | null;
  attempts: Attempt[];
  calibration: { samples: number; ratio: number } | null;
  quality: QualityReport | null;
  /** Present for `impossible`: the smallest size that could fit. */
  minimumBytes: number | null;
  warnings: string[];
  error: { code: string; message: string } | null;
  engine: { name: string; version: string; encoder?: string } | null;
  elapsedMs: number;
}

/**
 * Minimal AbortSignal shape so the core needs neither DOM nor Node typings.
 * A real `AbortSignal` (browser or Node) satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** Progress reported by an engine during one encode: fraction 0..1 of that encode. */
export type EncodeProgress = (fraction: number) => void;

export interface EncodeOptions {
  signal?: AbortSignalLike;
  onProgress?: EncodeProgress;
}

export interface EncodeResult<O> {
  /** Engine-specific handle to the encoded file (a temp path in Node, a Blob in the browser). */
  output: O;
  /** Exact size of the encoded file in bytes. */
  bytes: number;
  /** Bytes of video payload, if the engine can measure it (improves calibration). */
  videoBytes?: number;
  /** Bytes of audio payload, if known. */
  audioBytes?: number;
  /** Encoder that actually ran (e.g. libx264, h264_videotoolbox, webcodecs:avc1.640028). */
  encoder?: string;
}

/**
 * The one interface both engines implement (ffmpeg in Node, WebCodecs in the browser).
 * `I` is the engine's input handle (file path, File/Blob); `O` its output handle.
 */
export interface Engine<I = unknown, O = unknown> {
  readonly name: string;
  readonly version: string;
  probe(input: I, opts?: { signal?: AbortSignalLike }): Promise<Probe>;
  capabilities(): Promise<Capabilities>;
  encode(input: I, spec: EncodeSpec, opts?: EncodeOptions): Promise<EncodeResult<O>>;
  /** Frees an output the fit loop decided not to keep (deletes temp files, drops Blobs). */
  discard?(output: O): Promise<void> | void;
  /** Decodes matched frames of input and output and returns SSIM/PSNR (see `compareFrames`). */
  measureQuality?(input: I, output: O, spec: EncodeSpec, opts: { frames: number; signal?: AbortSignalLike }): Promise<QualityMetrics>;
}

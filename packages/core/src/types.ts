// Shared data types (PLAN §4.9). Everything except EngineCapabilities.canEncode is plain,
// JSON-serialisable data, so it can cross a Web Worker boundary, go into a job file, or be
// printed by the CLI/MCP unchanged.

export type Bytes = number;
export type VideoCodecId = 'h264' | 'hevc' | 'av1' | 'vp9';
export type AudioCodecId = 'aac' | 'opus';
export type ContainerId = 'mp4' | 'webm';
/** compatible = H.264; smaller = AV1 → HEVC (first encodable); or force one codec. */
export type CodecChoice = 'compatible' | 'smaller' | VideoCodecId;

export interface ProbeVideo {
  /** Normalised codec name: h264 | hevc | av1 | vp9 | vp8 | mpeg2video | prores | … */
  codec: string;
  /** Whether this engine can decode it. */
  decodable: boolean;
  codedWidth: number;
  codedHeight: number;
  /** After rotation and pixel aspect: what the viewer sees. */
  displayWidth: number;
  displayHeight: number;
  /** Clockwise. (ffprobe's displaymatrix rotation is CCW: cw = (360 − ccw) % 360.) */
  rotation: 0 | 90 | 180 | 270;
  /** Average frame rate. */
  fps: number;
  frameCount?: number;
  /** Video stream bitrate, bits/s. */
  bitrate?: number;
  hdr: boolean;
  transfer?: string;
  primaries?: string;
  bitDepth?: number;
}

export interface ProbeAudio {
  codec: string;
  channels: number;
  sampleRate: number;
  /** bits/s */
  bitrate?: number;
  decodable: boolean;
}

export interface Probe {
  /** 'mp4' | 'mov' | 'webm' | 'mkv' | 'unknown' … */
  container: string;
  sizeBytes: Bytes;
  durationSec: number;
  video: ProbeVideo | null;
  audio: ProbeAudio | null;
}

export interface Target {
  bytes: Bytes;
  presetId?: string;
  label: string;
}

export interface TrimRange {
  startSec: number;
  endSec: number;
}

export interface Options {
  /** Default 'compatible'. */
  codec: CodecChoice;
  /** "Max height" in the UI: 720p-class, applied to the short side (either orientation). */
  maxShortSide?: number;
  fpsCap?: number;
  keepFps: boolean;
  mute: boolean;
  trim?: TrimRange;
  reencode: boolean;
  /** 1..8. Default: 3 for two-pass encoders, 4 otherwise. */
  maxAttempts?: number;
  /** 8..12, default 10. */
  qualityFrames?: number;
}

export interface EngineCapabilities {
  id: 'web' | 'ffmpeg';
  version: string;
  encoderName: Partial<Record<VideoCodecId, string>>;
  videoCodecs: VideoCodecId[];
  audioCodecs: AudioCodecId[];
  containers: ContainerId[];
  /** True when the primary (H.264) encoder runs two passes (rate lands within a few percent). */
  twoPass: boolean;
  /** Extension: codecs whose encoder is two-pass (used by rateCalibration 'auto'). Defaults to ['h264'] when twoPass. */
  twoPassCodecs?: VideoCodecId[];
  /** Fraction of the target held back on the first attempt (m in PLAN §4.1). */
  initialMargin: number;
  /** Extension: per-codec margin override (e.g. videotoolbox 0.04 while libx264 is 0.02). */
  marginByCodec?: Partial<Record<VideoCodecId, number>>;
  rateCalibration: 'always' | 'auto' | 'never';
  audioCopyWithTrim: boolean;
  maxEncodeShortSide: Partial<Record<VideoCodecId, number>>;
  /** Synchronous; engines precompute. */
  canEncode(codec: VideoCodecId, w: number, h: number, bps: number): boolean;
}

export interface Rung {
  shortSide: number;
  width: number;
  height: number;
  fps: number;
  bpp: number;
}

export type Warning = { code: string; message: string };

export interface PlanVideo {
  codec: VideoCodecId;
  width: number;
  height: number;
  fps: number;
  /** Requested video bitrate, bits/s. */
  bitrate: number;
  bpp: number;
  bppTier: 'A' | 'B';
  keyframeIntervalSec: number;
  rungIndex: number;
  capped?: 'quality-ceiling' | 'source-bitrate';
}

export interface PlanAudio {
  mode: 'encode' | 'copy' | 'none';
  codec?: AudioCodecId;
  bitrate?: number;
  channels?: 1 | 2;
  sampleRate?: number;
  bytes: Bytes;
}

export interface Plan {
  version: 1;
  feasible: boolean;
  passThrough: boolean;
  targetBytes: Bytes;
  marginBytes: Bytes;
  overheadBytes: Bytes;
  minimumBytes: Bytes;
  durationSec: number;
  container: ContainerId;
  video: PlanVideo | null;
  audio: PlanAudio;
  rungs: Rung[];
  trim?: TrimRange;
  warnings: Warning[];
  /** Extension: plain-words explanation of each decision (shown by `snugclip plan`). */
  reasons: string[];
}

export type EncodePurpose = 'calibration' | 'full' | 'rescue';

/** One engine invocation. */
export interface EncodePlan<I> {
  input: I;
  purpose: EncodePurpose;
  container: ContainerId;
  trim?: TrimRange;
  video: {
    codec: VideoCodecId;
    width: number;
    height: number;
    fps: number;
    bitrate: number;
    keyframeIntervalSec: number;
    latency?: 'quality' | 'realtime';
  };
  audio: PlanAudio;
  hdrToSdr: boolean;
}

export interface EncodeResult<O> {
  output: O;
  bytes: Bytes;
  videoBytes?: Bytes;
  audioBytes?: Bytes;
  durationSec: number;
  encoder: string;
}

export interface Attempt {
  index: number;
  purpose: EncodePurpose;
  rung: Rung;
  requestedVideoBitrate: number;
  bytes: Bytes;
  videoBytes?: Bytes;
  fits: boolean;
  elapsedMs: number;
  /** Extension: why this attempt ended the way it did. */
  note?: string;
}

/** RGBA pixels (despite the name); core converts to luma. */
export interface LumaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Minimal AbortSignal shape so the core needs neither DOM nor Node typings. A real
 * `AbortSignal` (browser or Node) satisfies it.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface EncodeProgress {
  fraction: number;
  encodedSec: number;
}

export interface Engine<I, O> {
  readonly id: 'web' | 'ffmpeg';
  capabilities(): Promise<EngineCapabilities>;
  probe(input: I): Promise<Probe>;
  encode(plan: EncodePlan<I>, opts: { signal: AbortSignalLike; onProgress?: (p: EncodeProgress) => void }): Promise<EncodeResult<O>>;
  /** Frames nearest to `timesSec` (each file's own timeline), scaled so the short side = evalShortSide, RGBA. */
  frames(src: I | O, timesSec: number[], evalShortSide: number, signal: AbortSignalLike): Promise<LumaFrame[]>;
  /** The input unchanged as an output (web: the original File; CLI: a byte-identical copy). */
  passThrough(input: I): Promise<O>;
  /** temp → final (CLI) / mark final (web). The core calls it only when bytes ≤ target. */
  commit(output: O): Promise<O>;
  discard(output: O): Promise<void>;
}

export interface QualityReport {
  frames: number;
  evalShortSide: number;
  ssimMean: number;
  ssimMin: number;
  psnrMean: number;
  psnrMin: number;
  verdict: 'great' | 'softer' | 'soft';
  label: string;
  /** Extension: SSIM implementation and variant, e.g. "ssim.js weber". */
  algorithm?: string;
}

export type ReportStatus = 'fit' | 'passthrough' | 'impossible' | 'unsupported' | 'cancelled' | 'error';

export interface ReportOutput {
  name: string;
  path?: string;
  bytes: Bytes;
  container: ContainerId;
  mime: string;
  video: { codec: VideoCodecId; width: number; height: number; fps: number; bitrate: number } | null;
  audio: { codec: AudioCodecId | 'copy'; bitrate: number; channels: number } | null;
  durationSec: number;
}

export interface Report {
  snugclip: 'report';
  version: 1;
  /** From the injected clock. */
  createdAt: string;
  status: ReportStatus;
  fits: boolean;
  passThrough: boolean;
  input: { name: string; path?: string; bytes: Bytes; probe: Probe | null };
  target: Target;
  /** Null unless status is fit/passthrough. For pass-through, codec fields describe the source. */
  output: ReportOutput | null;
  plan: Plan | null;
  attempts: Attempt[];
  quality: QualityReport | null;
  complexity?: 'low' | 'medium' | 'high';
  minimumBytes?: Bytes;
  minimumSource?: 'planned' | 'measured';
  warnings: Warning[];
  error?: { code: string; message: string; hint?: string };
  engine: { id: 'web' | 'ffmpeg'; version: string; encoder: string };
  elapsedMs: number;
}

export type FitPhase = 'probing' | 'planning' | 'calibrating' | 'encoding' | 'checking' | 'done';

export interface FitProgress {
  phase: FitPhase;
  /** Full-attempt number (1-based) while encoding; sample number while calibrating. */
  attempt: number;
  /** Expected number of full attempts (re-normalised live). */
  expectedAttempts: number;
  /** Whole job, 0..1, monotonic. */
  overall: number;
  elapsedMs: number;
  /** null until there's enough signal. */
  etaMs: number | null;
}

/** Injected timers for the stall watchdog (the core never touches host globals). */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

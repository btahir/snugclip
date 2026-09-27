// Zod schemas mirroring the public types, so the CLI, MCP server and tests can validate every
// JSON document Snugclip emits, and so JSON Schema can be generated (`z.toJSONSchema`).
import { z } from 'zod';

const nonNeg = z.number().min(0);

export const WarningSchema = z.object({ code: z.string(), message: z.string() });

export const ProbeSchema = z.object({
  container: z.string(),
  sizeBytes: z.number().int().min(0),
  durationSec: nonNeg,
  video: z
    .object({
      codec: z.string(),
      decodable: z.boolean(),
      codedWidth: z.number().int(),
      codedHeight: z.number().int(),
      displayWidth: z.number().int(),
      displayHeight: z.number().int(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
      fps: nonNeg,
      frameCount: z.number().int().optional(),
      bitrate: nonNeg.optional(),
      hdr: z.boolean(),
      transfer: z.string().optional(),
      primaries: z.string().optional(),
      bitDepth: z.number().int().optional(),
    })
    .nullable(),
  audio: z
    .object({
      codec: z.string(),
      channels: z.number().int(),
      sampleRate: z.number().int(),
      bitrate: nonNeg.optional(),
      decodable: z.boolean(),
    })
    .nullable(),
});

export const TargetSchema = z.object({ bytes: z.number().int().positive(), presetId: z.string().optional(), label: z.string() });

export const TrimSchema = z.object({ startSec: nonNeg, endSec: z.number().positive() });

const VideoCodec = z.enum(['h264', 'hevc', 'av1', 'vp9']);
const AudioCodec = z.enum(['aac', 'opus']);
const Container = z.enum(['mp4', 'webm']);
export const CodecChoiceSchema = z.enum(['compatible', 'smaller', 'h264', 'hevc', 'av1', 'vp9']);

export const OptionsSchema = z.object({
  codec: CodecChoiceSchema.optional().describe('compatible (H.264 MP4, default) | smaller (AV1, else HEVC) | a specific codec'),
  maxShortSide: z.number().int().min(64).max(8640).nullable().optional().describe('"Max height" applied to the short side, e.g. 720'),
  fpsCap: z.number().positive().max(240).nullable().optional(),
  keepFps: z.boolean().optional(),
  mute: z.boolean().optional(),
  trim: TrimSchema.nullable().optional().describe('Seconds from the start of the source'),
  reencode: z.boolean().optional().describe('Re-encode even when the file is already under the target'),
  maxAttempts: z.number().int().min(1).max(8).optional(),
  qualityFrames: z.number().int().min(1).max(30).optional(),
});

export const RungSchema = z.object({ shortSide: z.number().int(), width: z.number().int(), height: z.number().int(), fps: nonNeg, bpp: z.number() });

export const PlanAudioSchema = z.object({
  mode: z.enum(['encode', 'copy', 'none']),
  codec: AudioCodec.optional(),
  bitrate: nonNeg.optional(),
  channels: z.union([z.literal(1), z.literal(2)]).optional(),
  sampleRate: z.number().int().optional(),
  bytes: z.number().int().min(0),
});

export const PlanSchema = z.object({
  version: z.literal(1),
  feasible: z.boolean(),
  passThrough: z.boolean(),
  targetBytes: z.number().int(),
  marginBytes: z.number().int(),
  overheadBytes: z.number().int(),
  minimumBytes: z.number().int(),
  durationSec: nonNeg,
  container: Container,
  video: z
    .object({
      codec: VideoCodec,
      width: z.number().int(),
      height: z.number().int(),
      fps: nonNeg,
      bitrate: z.number().int(),
      bpp: z.number(),
      bppTier: z.enum(['A', 'B']),
      keyframeIntervalSec: z.number(),
      rungIndex: z.number().int(),
      capped: z.enum(['quality-ceiling', 'source-bitrate']).optional(),
    })
    .nullable(),
  audio: PlanAudioSchema,
  rungs: z.array(RungSchema),
  trim: TrimSchema.optional(),
  warnings: z.array(WarningSchema),
  reasons: z.array(z.string()),
});

export const AttemptSchema = z.object({
  index: z.number().int(),
  purpose: z.enum(['calibration', 'full', 'rescue']),
  rung: RungSchema,
  requestedVideoBitrate: z.number(),
  bytes: z.number().int(),
  videoBytes: z.number().int().optional(),
  fits: z.boolean(),
  elapsedMs: nonNeg,
  note: z.string().optional(),
});

export const QualitySchema = z.object({
  frames: z.number().int(),
  evalShortSide: z.number().int(),
  ssimMean: z.number(),
  ssimMin: z.number(),
  psnrMean: z.number(),
  psnrMin: z.number(),
  verdict: z.enum(['great', 'softer', 'soft']),
  label: z.string(),
  algorithm: z.string().optional(),
});

export const ErrorSchema = z.object({ code: z.string(), message: z.string(), hint: z.string().optional() });

export const ReportSchema = z.object({
  snugclip: z.literal('report'),
  version: z.literal(1),
  createdAt: z.string(),
  status: z.enum(['fit', 'passthrough', 'impossible', 'unsupported', 'cancelled', 'error']),
  fits: z.boolean(),
  passThrough: z.boolean(),
  input: z.object({ name: z.string(), path: z.string().optional(), bytes: z.number().int(), probe: ProbeSchema.nullable() }),
  target: TargetSchema,
  output: z
    .object({
      name: z.string(),
      path: z.string().optional(),
      bytes: z.number().int(),
      container: Container,
      mime: z.string(),
      video: z.object({ codec: z.string(), width: z.number().int(), height: z.number().int(), fps: nonNeg, bitrate: nonNeg }).nullable(),
      audio: z.object({ codec: z.string(), bitrate: nonNeg, channels: z.number().int() }).nullable(),
      durationSec: nonNeg,
    })
    .nullable(),
  plan: PlanSchema.nullable(),
  attempts: z.array(AttemptSchema),
  quality: QualitySchema.nullable(),
  complexity: z.enum(['low', 'medium', 'high']).optional(),
  minimumBytes: z.number().int().optional(),
  minimumSource: z.enum(['planned', 'measured']).optional(),
  warnings: z.array(WarningSchema),
  error: ErrorSchema.optional(),
  engine: z.object({ id: z.enum(['web', 'ffmpeg']), version: z.string(), encoder: z.string() }),
  elapsedMs: nonNeg,
});

export const PresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  group: z.enum(['platform', 'size']),
  bytes: z.number().int(),
  sourceUrl: z.string(),
  checked: z.string(),
  statedLimit: z.string(),
  unit: z.string(),
  note: z.string(),
  maxShortSide: z.number().int().optional(),
  aliases: z.array(z.string()),
});

/** `{ preset }` XOR `{ bytes }` XOR `{ size }`. */
export const JobTargetSchema = z.union([
  z.strictObject({ preset: z.string().min(1) }),
  z.strictObject({ bytes: z.number().int().positive() }),
  z.strictObject({ size: z.string().min(1) }),
]);

export const JobSchema = z.looseObject({
  $schema: z.string().optional(),
  snugclip: z.literal('job'),
  version: z.literal(1),
  target: JobTargetSchema,
  options: OptionsSchema.omit({ maxAttempts: true, qualityFrames: true }).strict().optional(),
  inputs: z.array(z.string()).optional().describe('CLI/MCP only; globs allowed; ignored by the web app'),
  output: z.strictObject({ dir: z.string().optional(), pattern: z.string().optional() }).optional().describe('CLI only; pattern tokens {name} {size} {ext}'),
  reports: z.array(z.looseObject({ snugclip: z.literal('report') })).optional(),
});

/** CLI `--json` envelopes (PLAN §7.1). */
export const CliEnvelopeSchema = z.object({
  snugclip: z.enum(['compress', 'plan', 'probe', 'presets']),
  version: z.literal(1),
  results: z.array(z.unknown()).optional(),
  error: ErrorSchema.optional(),
});
export const PlanResultSchema = z.object({ input: z.string(), probe: ProbeSchema.nullable(), plan: PlanSchema.nullable(), error: ErrorSchema.optional() });
export const ProbeResultSchema = z.object({ input: z.string(), probe: ProbeSchema.nullable(), error: ErrorSchema.optional() });

/** JSON Schemas (draft 2020-12) for publishing and for ajv validation in tests. */
export function jsonSchemas() {
  return {
    job: z.toJSONSchema(JobSchema, { target: 'draft-2020-12' }),
    report: z.toJSONSchema(ReportSchema, { target: 'draft-2020-12' }),
    plan: z.toJSONSchema(PlanSchema, { target: 'draft-2020-12' }),
    probe: z.toJSONSchema(ProbeSchema, { target: 'draft-2020-12' }),
    preset: z.toJSONSchema(PresetSchema, { target: 'draft-2020-12' }),
    planResult: z.toJSONSchema(PlanResultSchema, { target: 'draft-2020-12' }),
    probeResult: z.toJSONSchema(ProbeResultSchema, { target: 'draft-2020-12' }),
  };
}

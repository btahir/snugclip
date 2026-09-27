// Snugclip's local MCP server (PLAN §7.2): stdio only, files by path, no network, no keys.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  CORE_VERSION,
  OptionsSchema,
  PlanResultSchema,
  PRESETS,
  PresetSchema,
  ProbeResultSchema,
  ReportSchema,
  SnugclipError,
  formatSize,
  isSnugclipError,
  resolveTarget,
  type FitProgress,
  type Options,
  type Report,
  type Target,
} from '@snugclip/core';
import { compressFiles, expandInputs, planFiles, probeFiles, type RunnerOptions } from '@snugclip/engine-ffmpeg';

const TargetIn = z
  .object({
    preset: z.string().optional().describe('Preset id, e.g. "discord" (20 MB), "whatsapp" (64 MB, 720p), "gmail" (18 MB), "email" (14.5 MB), "size-8". See list_presets.'),
    size: z.union([z.string(), z.number().int().positive()]).optional().describe('Exact limit: "10MB", "9.5MiB", "800KB" (decimal MB = 1,000,000 bytes) or an integer number of bytes.'),
  })
  .describe('Where the file is going. Give exactly one of preset or size.');

const OptionsIn = OptionsSchema.omit({ qualityFrames: true }).describe('Optional encode settings. The defaults just work.');

const inputsIn = z.array(z.string().min(1)).min(1).describe('Video file paths (absolute, or relative to the server\'s working directory). Directories and globs are expanded.');

export interface ServerOptions {
  /** Base for relative paths (default process.cwd()). */
  cwd?: string;
  env?: Record<string, string | undefined>;
}

function targetOf(t: z.infer<typeof TargetIn>): Target {
  const hasPreset = t.preset !== undefined && t.preset !== '';
  const hasSize = t.size !== undefined && t.size !== '';
  if (hasPreset === hasSize) throw new SnugclipError('E_ARGS', 'Give exactly one of target.preset or target.size.');
  return hasSize ? (typeof t.size === 'number' ? resolveTarget({ bytes: t.size }) : resolveTarget({ size: t.size! })) : resolveTarget({ preset: t.preset! });
}

function cleanOptions(o: z.infer<typeof OptionsIn> | undefined): Partial<Options> {
  const out: Partial<Options> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v !== null && v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function errorResult(e: unknown): CallToolResult {
  const err = isSnugclipError(e) ? e.toJSON() : { code: 'E_INTERNAL', message: (e as Error)?.message ?? String(e) };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(err) }] };
}

function summary(r: Report): string {
  switch (r.status) {
    case 'fit':
      return `fit: ${r.input.name} → ${r.output!.path} (${formatSize(r.output!.bytes)} ≤ ${r.target.label}${r.quality ? `, ${r.quality.label}, SSIM ${r.quality.ssimMean.toFixed(3)}` : ''})`;
    case 'passthrough':
      return `passthrough: ${r.input.name} is already ${formatSize(r.output!.bytes)}, under ${r.target.label}; copied untouched to ${r.output!.path}`;
    case 'impossible':
      return `impossible: ${r.input.name} can't fit ${r.target.label}; the minimum is ${formatSize(r.minimumBytes ?? 0, { round: 'ceil' })} (minimumBytes ${r.minimumBytes}).`;
    default:
      return `${r.status}: ${r.input.name}: ${r.error?.message ?? ''}`;
  }
}

export function createServer(opts: ServerOptions = {}): McpServer {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const server = new McpServer({ name: 'snugclip', version: CORE_VERSION }, { capabilities: { tools: {} } });
  const base = (): RunnerOptions => {
    const ro: RunnerOptions = { cwd, env };
    if (env.SNUGCLIP_FIXED_CLOCK) ro.fixedClock = env.SNUGCLIP_FIXED_CLOCK;
    return ro;
  };

  server.registerTool(
    'compress_video',
    {
      title: 'Compress video to an exact size',
      description:
        'Re-encodes each video so the file is guaranteed to be at or under the target size in bytes (it never writes a file over the limit). ' +
        'Files already under the target are copied untouched (status "passthrough"). If the target is impossible even at the lowest quality, ' +
        'nothing is encoded and status is "impossible" with minimumBytes. Other statuses: "fit", "unsupported", "error", "cancelled". ' +
        'Outputs go next to each input as <name>-snug-<size>.<ext> unless outputDir/output is given; existing files are never overwritten unless overwrite is true. ' +
        'Each report includes bytes, resolution, bitrates, attempts and a quality check (SSIM/PSNR with a plain-words verdict). Uses the local ffmpeg; no network.',
      inputSchema: {
        inputs: inputsIn,
        target: TargetIn,
        options: OptionsIn.optional(),
        outputDir: z.string().optional().describe('Folder for outputs (default: next to each input).'),
        output: z.string().optional().describe('Exact output path (single input only).'),
        overwrite: z.boolean().optional().describe('Replace existing output files (default false).'),
      },
      outputSchema: { results: z.array(ReportSchema) },
      annotations: { destructiveHint: false, openWorldHint: false, idempotentHint: false },
    },
    async (args, extra): Promise<CallToolResult> => {
      try {
        const target = targetOf(args.target);
        const ro = base();
        if (args.outputDir) ro.outDir = args.outputDir;
        if (args.output) ro.output = args.output;
        if (args.overwrite) ro.overwrite = true;
        ro.signal = extra.signal;
        const token = extra._meta?.progressToken;
        const inputs = expandInputs(args.inputs, cwd);
        if (token !== undefined) {
          let last = -1;
          let index = 0;
          ro.onItemStart = (_input, i) => {
            index = i;
          };
          ro.onProgress = (input, p: FitProgress) => {
            const progress = Math.round(((index + p.overall) / inputs.length) * 1000) / 1000;
            if (progress - last < 0.02 && p.phase !== 'done') return;
            last = progress;
            void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total: 1, message: `${input}: ${p.phase}` } }).catch(() => {});
          };
        }
        const results = await compressFiles(inputs, target, cleanOptions(args.options), ro);
        return { content: [{ type: 'text', text: results.map(summary).join('\n') }], structuredContent: { results } };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    'plan_compression',
    {
      title: 'Plan a compression (dry run)',
      description:
        'Free and instant: probes each video and returns the plan Snugclip would use for the target (resolution, fps, codec, video/audio bitrates, ' +
        'quality tier) plus minimumBytes, the smallest size that can fit. Nothing is encoded or written. plan.feasible=false means the target is impossible.',
      inputSchema: { inputs: inputsIn, target: TargetIn, options: OptionsIn.optional() },
      outputSchema: { results: z.array(PlanResultSchema) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const results = await planFiles(expandInputs(args.inputs, cwd), targetOf(args.target), cleanOptions(args.options), base());
        if (results.every((r) => r.error)) return errorResult(new SnugclipError(results[0]!.error!.code as never, results[0]!.error!.message));
        const text = results
          .map((r) => (r.plan ? `${r.input}: ${r.plan.feasible ? (r.plan.passThrough ? 'already fits (pass-through)' : r.plan.reasons.join(' ')) : `impossible; minimumBytes ${r.plan.minimumBytes}`}` : `${r.input}: ${r.error?.message}`))
          .join('\n');
        return { content: [{ type: 'text', text }], structuredContent: { results } };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    'probe_video',
    {
      title: 'Probe video files',
      description: 'Reads container, duration, size, codecs, display dimensions (after rotation), fps, bitrates and HDR flag of each video. Read-only.',
      inputSchema: { inputs: inputsIn },
      outputSchema: { results: z.array(ProbeResultSchema) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const results = await probeFiles(expandInputs(args.inputs, cwd), base());
        if (results.every((r) => r.error)) {
          const e = results[0]!.error!;
          return { isError: true, content: [{ type: 'text', text: JSON.stringify(e) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(results) }], structuredContent: { results } };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    'list_presets',
    {
      title: 'List size presets',
      description: 'Platform limits (Discord, WhatsApp, Gmail, Outlook, Slack, Telegram, iMessage) and generic sizes, each with bytes, the official source URL and the date checked.',
      inputSchema: {},
      outputSchema: { presets: z.array(PresetSchema) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (): Promise<CallToolResult> => ({
      content: [{ type: 'text', text: PRESETS.map((p) => `${p.id}: ${formatSize(p.bytes)} (${p.label})`).join('\n') }],
      structuredContent: { presets: [...PRESETS] },
    }),
  );

  return server;
}

/** Starts the server on stdio (the `snugclip-mcp` bin and `snugclip mcp`). */
export async function startStdioServer(opts: ServerOptions = {}): Promise<McpServer> {
  const server = createServer(opts);
  await server.connect(new StdioServerTransport());
  return server;
}

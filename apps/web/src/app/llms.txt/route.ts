// llms.txt: what Snugclip is and how agents drive it (CLI, MCP, job files, deep links).
import { JOB_SCHEMA_URL, PRESETS, SITE_URL, SUPPORT_URL } from '@snugclip/core';
import { KEYWORD_PAGES } from '@/content/pages';
import { limitText } from '@/lib/format';

export const dynamic = 'force-static';

export function GET() {
  const presets = PRESETS.map((p) => `- \`${p.id}\` (${p.label}): ${limitText(p.bytes)} = ${p.bytes.toLocaleString('en-US')} bytes${p.maxShortSide ? `, capped at ${p.maxShortSide}p` : ''}`).join('\n');
  const pages = KEYWORD_PAGES.map((p) => `- [${p.h1}](${SITE_URL}/${p.slug}/): ${p.description}`).join('\n');
  const body = `# Snugclip

> Free, open-source (MIT) video compressor that fits a clip under an exact byte limit and never outputs a file larger than the target. The web app runs entirely in the browser (WebCodecs; nothing is uploaded, works offline). The same engine is a CLI and a local MCP server that use the user's installed ffmpeg.

Site: ${SITE_URL}/
Support: ${SUPPORT_URL}

## Guarantees
- Output bytes <= target bytes, always. Over-target attempts are discarded, never saved.
- If even the lowest quality can't fit, it refuses before encoding and reports \`minimumBytes\`.
- Files already under the target are returned byte-identical (pass-through) unless re-encoding is requested.
- Sizes are bytes; UI shows decimal MB (1 MB = 1,000,000 bytes).
- Every result carries a quality report: mean/min SSIM and PSNR over sampled frames, and a verdict (great | softer | soft).

## CLI (\`snugclip\`)
Human logs go to stderr; \`--json\` prints exactly one JSON document to stdout: \`{ "snugclip": "<command>", "version": 1, "results": [...] }\`.

\`\`\`
snugclip compress <input...> (--preset <id> | --size <10MB>) [options] [--json]
snugclip plan     <input...> (--preset <id> | --size <10MB>) [options] [--json]   # dry run: chosen resolution/fps/bitrates + minimum size, no encode
snugclip probe    <input...> [--json]
snugclip presets  [--json]
snugclip mcp                                                                   # start the stdio MCP server
options: --codec compatible|smaller|h264|hevc|av1|vp9  --max-height <px>  --fps <n>  --keep-fps
         --mute  --start <sec|hh:mm:ss.ms>  --end <...>  --reencode  --attempts <1-8>
         -o, --output <file>  --out-dir <dir>  --overwrite  --job <file>  --save-job <file>
         --ffmpeg <path>  --ffprobe <path>  --no-support  --quiet
\`\`\`

Exit codes: 0 all fit (or pass-through), 2 impossible target (JSON includes \`minimumBytes\`), 3 unsupported input, 4 ffmpeg/ffprobe missing, 1 anything else. Batch precedence 4 > 1 > 3 > 2 > 0.

Example: \`snugclip compress clip.mov --preset discord --json\` writes \`clip-snug-20MB.mp4\` next to the input.

## MCP server (stdio, no network, no keys)
Start with \`snugclip mcp\` (or \`snugclip-mcp\`). Files are passed by path. Tools:
- \`compress_video\` { inputs: string[], target: { preset } | { size }, options?, outputDir?, output?, overwrite? } -> { results: Report[] }
- \`plan_compression\` { inputs, target, options? } -> { results: { input, probe, plan }[] } (free: no encode)
- \`probe_video\` { inputs } -> { results: { input, probe }[] }
- \`list_presets\` {} -> { presets: Preset[] }
Errors return \`isError: true\` with { code, message, hint } (E_FFMPEG_MISSING, E_UNSUPPORTED, E_IMPOSSIBLE, ...). Long runs send progress notifications and honour cancellation.

## Job files (\`*.snugclip.json\`, schema v1)
JSON Schema: ${JOB_SCHEMA_URL}
\`\`\`json
{
  "$schema": "${JOB_SCHEMA_URL}",
  "snugclip": "job",
  "version": 1,
  "target": { "preset": "discord" },
  "options": { "codec": "compatible", "maxShortSide": 720, "keepFps": false, "mute": false, "trim": { "startSec": 1.5, "endSec": 9.25 }, "reencode": false },
  "inputs": ["clips/a.mov"],
  "reports": []
}
\`\`\`
\`target\` is exactly one of { preset }, { bytes } or { size: "10MB" }. The web app imports a dropped job file (target + options) and exports setups and run reports in this format; the CLI reads it with \`--job\` and writes it with \`--save-job\`.

## Deep links (hand a person a ready setup)
\`${SITE_URL}/?preset=discord&codec=h264&maxh=720\`
Params: preset, size (e.g. 10MB; overrides preset), codec, maxh (short side), fps, keepfps=1, mute=1, start, end (seconds, applied to every dropped file), reencode=1. Invalid values are ignored with a notice. Links never carry file names.

## Presets
${presets}

## Pages
${pages}
- [About and privacy](${SITE_URL}/about/)
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

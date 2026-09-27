# Snugclip for agents

Snugclip fits a video under an exact byte limit and **never writes a file over it**. If even the lowest quality can't fit, it refuses before encoding and tells you the smallest size that can. Files already under the limit are passed through byte-for-byte.

The same engine runs as:

- a **CLI** (`snugclip`) with `--json` output and stable exit codes,
- a **local MCP server** (`snugclip-mcp`, stdio) with four tools,
- the web app at https://snugclip.vercel.app (WebCodecs, runs in the browser).

The CLI and MCP server use the ffmpeg/ffprobe installed on the machine (never bundled). Nothing is uploaded and there are no network calls.

## Setup

```bash
pnpm install && pnpm build                 # from the repo root (Node 22.12+, pnpm 11)
node packages/cli/bin/snugclip.js --help   # or: pnpm snugclip --help
```

ffmpeg is required: `brew install ffmpeg` (macOS), `sudo apt install ffmpeg` (Debian/Ubuntu), `winget install Gyan.FFmpeg` (Windows). Point to specific binaries with `--ffmpeg/--ffprobe` or `SNUGCLIP_FFMPEG/SNUGCLIP_FFPROBE`.

## CLI

```
snugclip compress <input...> (--size 10MB | --preset discord) [options] [--json]
snugclip plan     <input...> (--size | --preset) [options] [--json]   # dry run: no encode
snugclip probe    <input...> [--json]
snugclip presets  [--json]
snugclip mcp                                                           # stdio MCP server
```

Inputs are file paths, directories (their videos, non-recursive) or globs.

| Option | Meaning |
|---|---|
| `--size <n>` | Limit: `10MB`, `9.5MiB`, `800KB`, `1.5GB`, or bytes (`8000000B`). 1 MB = 1,000,000 bytes. |
| `--preset <id>` | A platform or size preset (see below). |
| `--codec <c>` | `compatible` (H.264 + AAC MP4, default), `smaller` (AV1, else HEVC), or `h264`/`hevc`/`av1`/`vp9`. |
| `--max-height <px>` | Cap the short side (720 = 720p, either orientation). Never upscales. |
| `--fps <n>` / `--keep-fps` | Cap the frame rate / never drop frames (by default 60 fps drops to 30 before resolution drops). |
| `--start <t>` `--end <t>` | Trim, in seconds or `hh:mm:ss.ms` (aliases `--trim-start/--trim-end`). |
| `--mute` | Drop the audio. |
| `--reencode` | Re-encode even when the file is already under the limit. |
| `--attempts <1-8>` | Encode attempts before giving up (default 3 for two-pass x264, 4 otherwise). |
| `-o, --output <file>` / `--out-dir <dir>` | Output file (single input) / folder. Default: next to the input as `<name>-snug-<size>.<ext>`. |
| `--overwrite` | Replace existing outputs. Without it an existing output is an error and is left untouched. |
| `--job <file>` / `--save-job <file>` | Load settings from a job file (flags override) / save the job plus reports. |
| `--json` | Print exactly one JSON document on stdout. Logs go to stderr. |
| `--quiet`, `--no-support` | No progress line / no support line. |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Every file fits (or was already under the limit). |
| 2 | A target is impossible. `minimumBytes` in the JSON says the smallest size that fits. |
| 3 | Unsupported input (no video track, not a video, undecodable). |
| 4 | ffmpeg or ffprobe is missing (the message includes the install command). |
| 1 | Anything else: fit failed, file exists, bad arguments, I/O error, cancelled. |

Batches return the most severe code with precedence `4 > 1 > 3 > 2 > 0`. `plan` exits 2 when any plan is infeasible.

### JSON output

Every command prints `{ "snugclip": "<command>", "version": 1, "results": [...] }`. A fatal error before any file is processed prints `{ "snugclip": "<command>", "version": 1, "error": { "code", "message", "hint" } }`.

- `compress` → `results: Report[]`
- `plan` → `results: { input, probe, plan, error? }[]`
- `probe` → `results: { input, probe, error? }[]`
- `presets` → `results: Preset[]`

A `Report` (abridged):

```json
{
  "snugclip": "report", "version": 1, "createdAt": "2026-09-27T12:00:00.000Z",
  "status": "fit", "fits": true, "passThrough": false,
  "input":  { "name": "clip.mov", "path": "clip.mov", "bytes": 48213004, "probe": { "durationSec": 31.2, "video": { "codec": "hevc", "displayWidth": 1080, "displayHeight": 1920, "fps": 29.97, "hdr": true }, "audio": { "codec": "aac", "channels": 2 } } },
  "target": { "bytes": 20000000, "presetId": "discord", "label": "Discord" },
  "output": { "name": "clip-snug-20MB.mp4", "path": "/abs/clip-snug-20MB.mp4", "bytes": 19406118, "container": "mp4", "mime": "video/mp4",
              "video": { "codec": "h264", "width": 720, "height": 1280, "fps": 29.97, "bitrate": 4680000 },
              "audio": { "codec": "aac", "bitrate": 128000, "channels": 2 }, "durationSec": 31.2 },
  "plan": { "feasible": true, "minimumBytes": 402113, "video": { "bppTier": "A" }, "reasons": ["Audio: AAC 128 kbps.", "Video: 1080x1920 at 29.97 fps → 720x1280 …"] },
  "attempts": [ { "index": 0, "purpose": "full", "requestedVideoBitrate": 4680000, "bytes": 19406118, "fits": true } ],
  "quality": { "frames": 10, "evalShortSide": 720, "ssimMean": 0.9712, "ssimMin": 0.9544, "psnrMean": 38.1, "psnrMin": 36.4, "verdict": "great", "label": "Looks great" },
  "warnings": [ { "code": "hdr-to-sdr", "message": "HDR source: colours are converted to standard range…" } ],
  "engine": { "id": "ffmpeg", "version": "8.1.1", "encoder": "libx264" },
  "elapsedMs": 9120
}
```

`status` is one of `fit`, `passthrough`, `impossible`, `unsupported`, `cancelled`, `error`. `output` is non-null only for `fit` and `passthrough`, and `output.bytes ≤ target.bytes` always holds. Error codes: `E_IMPOSSIBLE`, `E_UNSUPPORTED`, `E_UNSUPPORTED_ENCODER`, `E_FFMPEG_MISSING`, `E_FIT_FAILED`, `E_EXISTS`, `E_ARGS`, `E_PRESET`, `E_TRIM`, `E_JOB`, `E_JOB_VERSION`, `E_STALL`, `E_CANCELLED`, `E_IO`, `E_ENCODE`.

Quality verdicts: **Looks great** (SSIM mean ≥ 0.95 and min ≥ 0.90), **Softer, still clear** (≥ 0.88 / ≥ 0.80), **Noticeably soft** (otherwise). SSIM and PSNR are measured on 10 matched frames, both scaled to min(720, source short side), so the score includes any resolution loss.

## Presets

Run `snugclip presets --json` for the full data, including each official source URL and the date it was checked (2026-09-27).

| id | Bytes | Notes |
|---|---|---|
| `discord` | 20,000,000 | Free limit since Aug 2026 (was 10 MB; use `size-10` for accounts still on it). |
| `discord-nitro-basic` / `discord-nitro` | 50,000,000 / 500,000,000 | |
| `whatsapp` | 64,000,000 | Also caps at 720p (WhatsApp downsizes to 720p anyway). |
| `whatsapp-document` | 2,000,000,000 | Sent as a document, no recompression. |
| `gmail` | 18,000,000 | 25 MB message limit minus base64 (+37%) and headers. |
| `outlook`, `email` | 14,500,000 | 20 MB message limit minus encoding. |
| `slack`, `telegram`, `telegram-premium`, `imessage` | 1 GB, 2 GB, 4 GB, 100 MB | |
| `size-8`, `size-10`, `size-25`, `size-50`, `size-100` | exact decimal MB | |

## MCP server

Start it with `snugclip-mcp` (or `snugclip mcp`). Example client config:

```json
{
  "mcpServers": {
    "snugclip": { "command": "node", "args": ["/path/to/snugclip/packages/mcp/bin/snugclip-mcp.js"] }
  }
}
```

| Tool | Input | Output |
|---|---|---|
| `compress_video` | `{ inputs: string[], target: { preset } \| { size }, options?, outputDir?, output?, overwrite? }` | `{ results: Report[] }` |
| `plan_compression` | `{ inputs: string[], target, options? }` (free: nothing is encoded) | `{ results: { input, probe, plan }[] }` |
| `probe_video` | `{ inputs: string[] }` | `{ results: { input, probe }[] }` |
| `list_presets` | `{}` | `{ presets: Preset[] }` |

`options` uses the job-file option names: `codec`, `maxShortSide`, `fpsCap`, `keepFps`, `mute`, `trim: { startSec, endSec }`, `reencode`, `maxAttempts`. Paths resolve against the server's working directory. Existing files are never overwritten unless `overwrite: true`, and inputs are never deleted. Long compressions send `notifications/progress` when the request carries a `progressToken`, and honour cancellation (temp files are removed). Errors come back as `isError: true` with a JSON `{ code, message, hint }` text block.

## Job files (`*.snugclip.json`, version 1)

A job file carries a target and options, so an agent can hand a person a ready setup (the web app opens it by drag and drop) or re-run a batch. JSON Schema: https://snugclip.vercel.app/schema/job.v1.json (generated from the core with `pnpm gen:schema`).

```json
{
  "$schema": "https://snugclip.vercel.app/schema/job.v1.json",
  "snugclip": "job",
  "version": 1,
  "target": { "preset": "discord" },
  "options": { "codec": "compatible", "maxShortSide": 720, "keepFps": false, "mute": false,
               "trim": { "startSec": 1.5, "endSec": 9.25 }, "reencode": false },
  "inputs": ["clips/a.mov", "clips/*.mp4"],
  "output": { "dir": "out/", "pattern": "{name}-snug-{size}.{ext}" },
  "reports": []
}
```

- `target` is exactly one of `{ "preset": "<id>" }`, `{ "bytes": 10000000 }` or `{ "size": "10MB" }`.
- `inputs` and `output` are used by the CLI/MCP and ignored by the web app. Relative inputs resolve against the job file's folder.
- `reports` holds Report objects after a run (`--save-job`).
- A different `version` is refused with `E_JOB_VERSION`; unknown top-level keys are kept on re-export.

## Deep links

`https://snugclip.vercel.app/?preset=discord&codec=h264&maxh=720` opens the web app with settings applied. Parameters: `preset`, `size` (overrides `preset`), `codec`, `maxh` (short side), `fps`, `keepfps=1`, `mute=1`, `start`, `end` (seconds), `reencode=1`. Invalid values are ignored with a notice. Links never carry file names.

## Worked examples

**Fit a clip for Discord and check the result:**

```bash
snugclip compress recording.mov --preset discord --json > out.json
jq '.results[0] | {status, bytes: .output.bytes, limit: .target.bytes, quality: .quality.label}' out.json
```

**"What's the smallest this can go?"** Plan with any small target and read `minimumBytes` (no encode happens):

```bash
snugclip plan talk.mp4 --size 1MB --json | jq '.results[0].plan.minimumBytes'
```

**Handle an impossible target:** exit code 2, `status: "impossible"`, and `minimumBytes` tells you what would fit. Either raise the target to at least that, or trim/mute and plan again:

```bash
snugclip compress long.mp4 --size 5MB --json > r.json; code=$?
if [ "$code" -eq 2 ]; then
  jq '.results[0].minimumBytes' r.json                                   # e.g. 7340012
  snugclip plan long.mp4 --size 5MB --mute --end 90 --json | jq '.results[0].plan.feasible'
fi
```

**Make a folder of screen recordings email-sized:**

```bash
snugclip compress ./recordings --preset email --out-dir ./email-ready --json
```

**Hand a person a ready setup:** write a job file and let them drop it on the web app together with their video:

```bash
snugclip compress clip.mp4 --preset whatsapp --save-job clip.snugclip.json
```

## Guarantees and limits

- Outputs are written to `<final>.snugclip-<pid>-<n>.tmp` and renamed only when `bytes ≤ target`. Over-target attempts are deleted, and so are temp files on Ctrl-C/cancel.
- The first attempt aims 2–4% under the target; the fit loop corrects with log-space secant steps, drops a resolution rung when the encoder can't go lower, and gives up with `E_FIT_FAILED` rather than keep an oversized file.
- HDR sources become 8-bit SDR. Without an ffmpeg built with zimg (zscale), colours aren't tone-mapped (`hdr-not-tonemapped` warning).
- Snugclip is free (MIT). If it saved you time: https://snugclip.vercel.app/support/

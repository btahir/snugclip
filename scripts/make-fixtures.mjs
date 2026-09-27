#!/usr/bin/env node
// Generates Snugclip's synthetic test fixtures with the system ffmpeg.
// Output: fixtures/generated/*.{mp4,mov,webm} plus manifest.json (gitignored, regenerable).
//
//   ../research/heavy.sh node scripts/make-fixtures.mjs          # all fixtures
//   node scripts/make-fixtures.mjs tiny-under-target              # one fixture by id
//   node scripts/make-fixtures.mjs --force                        # regenerate existing files
//
// Every clip is synthetic (lavfi test sources and generated tones); no real footage.
// Sizes are pinned with x264/x265 CBR (nal-hrd filler) so the whole set stays under 100 MB
// while most clips sit just above the 8 MB target, which forces a real encode.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'fixtures', 'generated');
const FF = process.env.SNUGCLIP_FFMPEG || 'ffmpeg';
const THREADS = ['-threads', '4'];

const tone = (dur, freq = 440) => ['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=${dur}`];
const aac = (kbps = 128) => ['-c:a', 'aac', '-b:a', `${kbps}k`, '-ac', '2'];
const x264cbr = (kbps) => [
  '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-b:v', `${kbps}k`, '-minrate', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`,
  '-x264-params', 'nal-hrd=cbr:force-cfr=1',
];

/** @type {{id:string,file:string,desc:string,args:(out:string)=>string[][]}[]} */
const FIXTURES = [
  {
    id: 'testsrc2-1080p30-60s',
    file: 'testsrc2-1080p30-60s.mp4',
    desc: 'testsrc2 1920x1080 30 fps, 60 s, H.264 + AAC 440 Hz tone (~25.3 MB, just over 25 MB)',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60', ...tone(60),
      ...x264cbr(3200), ...aac(128), '-shortest', '-movflags', '+faststart', out,
    ]],
  },
  {
    id: 'noise-720p30-8s',
    file: 'noise-720p30-8s.mp4',
    desc: 'High-noise 1280x720 30 fps, 8 s (temporal + spatial noise over testsrc2), H.264 + AAC',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=8,noise=alls=60:allf=t+u', ...tone(8, 330),
      ...x264cbr(7700), ...aac(96), '-shortest', out,
    ]],
  },
  {
    id: 'screen-static-1080p30-30s',
    file: 'screen-static-1080p30-30s.mp4',
    desc: 'Screen-recording-like: static 1920x1080 frame with a small moving cursor box, 30 s, no audio',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'mandelbrot=size=1920x1080:rate=30:end_pts=0.01,trim=end_frame=1,loop=loop=-1:size=1,setpts=N/30/TB,trim=duration=30,' +
        "drawbox=x='200+mod(t*120,1400)':y='300+mod(t*40,500)':w=24:h=24:color=white@1:t=fill," +
        'drawbox=x=0:y=0:w=1920:h=48:color=0x303040@1:t=fill',
      ...x264cbr(2200), '-r', '30', out,
    ]],
  },
  {
    id: 'testsrc2-1080p60-10s',
    file: 'testsrc2-1080p60-10s.mp4',
    desc: 'testsrc2 1920x1080 60 fps, 10 s, H.264 + AAC',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60:duration=10', ...tone(10, 550),
      ...x264cbr(6400), ...aac(128), '-shortest', out,
    ]],
  },
  {
    id: 'testsrc2-4k30-8s',
    file: 'testsrc2-4k30-8s.mp4',
    desc: 'testsrc2 3840x2160 30 fps, 8 s, H.264 + AAC',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=8', ...tone(8, 660),
      ...x264cbr(7800), ...aac(128), '-shortest', out,
    ]],
  },
  {
    id: 'portrait-rotated-10s',
    file: 'portrait-rotated-10s.mov',
    desc: 'Phone-style MOV: coded 1920x1080 with a 90° display matrix (shows as 1080x1920 portrait), 10 s, H.264 + AAC',
    args: (out) => {
      const tmp = out + '.tmp.mp4';
      return [
        ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10', ...tone(10, 480),
          ...x264cbr(6400), ...aac(128), '-shortest', tmp],
        ['-display_rotation:v:0', '90', '-i', tmp, '-c', 'copy', '-f', 'mov', out],
        { cleanup: tmp },
      ];
    },
  },
  {
    id: 'hevc-hdr10-1080p-10s',
    file: 'hevc-hdr10-1080p-10s.mov',
    desc: 'HEVC Main10 MOV tagged HDR10 (BT.2020 / PQ), 1920x1080 30 fps, 10 s, AAC',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=10', ...tone(10, 520),
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1',
      '-b:v', '6400k', '-x265-params', 'log-level=error:vbv-maxrate=6400:vbv-bufsize=6400:strict-cbr=1:hrd=1',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      ...aac(128), '-shortest', '-f', 'mov', out,
    ]],
  },
  {
    id: 'vp9-opus-720p-15s',
    file: 'vp9-opus-720p-15s.webm',
    desc: 'VP9 + Opus WebM, 1280x720 30 fps, 15 s',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=15,noise=alls=12:allf=t', ...tone(15, 400),
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1',
      '-b:v', '4000k', '-minrate', '4000k', '-maxrate', '4000k',
      '-c:a', 'libopus', '-b:a', '96k', '-shortest', out,
    ]],
  },
  {
    id: 'no-audio-1080p-15s',
    file: 'no-audio-1080p-15s.mp4',
    desc: 'No audio track: testsrc2 1920x1080 30 fps, 15 s, H.264 only',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=15', ...x264cbr(4300), out,
    ]],
  },
  {
    id: 'lowres-360p-5min',
    file: 'lowres-360p-5min.mp4',
    desc: 'Long low-res: testsrc2 640x360 30 fps, 5 minutes, H.264 + AAC 48 kbps',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=300', ...tone(300, 350),
      ...x264cbr(170), ...aac(48), '-shortest', out,
    ]],
  },
  {
    id: 'tiny-under-target',
    file: 'tiny-under-target.mp4',
    desc: 'Tiny clip already under every target: 320x240 30 fps, 5 s, H.264 + AAC (~150 KB)',
    args: (out) => [[
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=5', ...tone(5),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', ...aac(64), '-shortest', out,
    ]],
  },
];

function run(args) {
  // -threads applies to the output's encoder, so it goes right before the output path (last arg).
  const full = ['-hide_banner', '-loglevel', 'error', '-y', ...args];
  const out = full.pop();
  full.push(...THREADS, out);
  const r = spawnSync(FF, full, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${full.join(' ')}`);
}

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const only = argv.filter((a) => !a.startsWith('--'));
mkdirSync(outDir, { recursive: true });

const check = spawnSync(FF, ['-version'], { stdio: 'ignore' });
if (check.error || check.status !== 0) {
  console.error('ffmpeg not found. Install it (macOS: brew install ffmpeg) or set SNUGCLIP_FFMPEG.');
  process.exit(4);
}

const manifest = [];
let total = 0;
for (const fx of FIXTURES) {
  const out = join(outDir, fx.file);
  if (only.length && !only.includes(fx.id)) continue;
  if (!existsSync(out) || force) {
    const t0 = Date.now();
    const partial = out + '.partial' + (fx.file.match(/\.[a-z0-9]+$/)?.[0] ?? '');
    const steps = fx.args(partial);
    let cleanup;
    for (const step of steps) {
      if (Array.isArray(step)) run(step);
      else if (step && step.cleanup) cleanup = step.cleanup;
    }
    if (cleanup) rmSync(cleanup, { force: true });
    renameSync(partial, out);
    console.log(`made ${fx.file} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  const bytes = statSync(out).size;
  total += bytes;
  manifest.push({ id: fx.id, file: fx.file, bytes, desc: fx.desc });
}

if (!only.length) {
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), totalBytes: total, fixtures: manifest }, null, 2) + '\n');
}
for (const m of manifest) console.log(`${String(m.bytes).padStart(10)}  ${m.file}`);
console.log(`${String(total).padStart(10)}  total (${(total / 1e6).toFixed(1)} MB)`);
if (total > 100e6) {
  console.error('fixtures exceed the 100 MB budget');
  process.exit(1);
}

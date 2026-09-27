#!/usr/bin/env node
// Generates Snugclip's synthetic test fixtures (PLAN §12, F01–F17) with the system ffmpeg into
// fixtures/generated/ (gitignored, regenerable), plus manifest.json. Idempotent: existing files
// are skipped unless --force.
//
//   ../research/heavy.sh node scripts/make-fixtures.mjs     # all (≈ 1 min, ≤ 100 MB)
//   node scripts/make-fixtures.mjs F12 F17                  # some, by id
//   node scripts/make-fixtures.mjs --force                  # regenerate
//
// Every clip is synthetic (lavfi test sources, generated tones/noise); no real footage.
// Video bitrates are pinned with x264 CBR (nal-hrd filler) so sizes are predictable.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'fixtures', 'generated');
const FF = process.env.SNUGCLIP_FFMPEG || 'ffmpeg';
const BITEXACT = ['-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1'];

const sine = (dur, freq = 440) => ['-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=${dur}`];
const aac = (kbps, ch = 2) => ['-c:a', 'aac', '-b:a', `${kbps}k`, '-ac', String(ch)];
const x264 = (kbps) => [
  '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
  '-b:v', `${kbps}k`, '-minrate', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`,
  '-x264-params', 'nal-hrd=cbr:force-cfr=1',
];

const FIXTURES = [
  {
    id: 'F01', file: 'f01-testsrc2-1080p30-10s.mp4',
    desc: 'testsrc2 1920x1080 30 fps 10 s; H.264 6 Mb/s + AAC 128k stereo (sine + noise)',
    steps: (o) => [[
      '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=10',
      '-f', 'lavfi', '-i', 'anoisesrc=a=0.05:c=pink:r=48000:d=10',
      '-filter_complex', '[1:a][2:a]amix=inputs=2:duration=shortest[a]', '-map', '0:v', '-map', '[a]',
      ...x264(6000), ...aac(128), '-shortest', o,
    ]],
  },
  {
    id: 'F02', file: 'f02-noise-720p30-10s.mp4',
    desc: 'High-noise 1280x720 30 fps 10 s (temporal + uniform noise); H.264 6 Mb/s + AAC 96k',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=10,noise=alls=60:allf=t+u', ...sine(10, 330), ...x264(6000), ...aac(96), '-shortest', o]],
  },
  {
    id: 'F03', file: 'f03-screen-1080p30-30s.mp4',
    desc: 'Screen-recording-like: static light 1920x1080 grid with a moving cursor, 30 s; H.264 1.5 Mb/s + AAC 64k mono',
    steps: (o) => [[
      '-f', 'lavfi', '-i', "color=c=0xf4f4f0:s=1920x1080:r=30:d=30,drawgrid=w=160:h=90:t=2:c=0xd0d0d0,drawbox=x='mod(t*200\\,1800)':y=500:w=24:h=24:c=black:t=fill",
      ...sine(30, 300), ...x264(1500), ...aac(64, 1), '-shortest', o,
    ]],
  },
  {
    id: 'F04', file: 'f04-testsrc2-720p60-10s.mp4',
    desc: 'testsrc2 1280x720 60 fps 10 s; H.264 5 Mb/s + AAC 128k',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=60:d=10', ...sine(10, 550), ...x264(5000), ...aac(128), '-shortest', o]],
  },
  {
    id: 'F05', file: 'f05-testsrc2-2160p30-5s.mp4',
    desc: 'testsrc2 3840x2160 30 fps 5 s; H.264 16 Mb/s + AAC 128k',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30:d=5', ...sine(5, 660), ...x264(16000), ...aac(128), '-shortest', o]],
  },
  {
    id: 'F06', file: 'f06-rotated-1080p-10s.mp4',
    desc: 'Coded 1920x1080 with a 90° display matrix (shows 1080x1920 portrait), 10 s; H.264 4 Mb/s + AAC 128k',
    steps: (o) => {
      const tmp = o + '.tmp.mp4';
      return [
        ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=10', ...sine(10, 480), ...x264(4000), ...aac(128), '-shortest', tmp],
        ['-display_rotation:v:0', '90', '-i', tmp, '-c', 'copy', o],
        { cleanup: tmp },
      ];
    },
  },
  {
    id: 'F07', file: 'f07-portrait-720x1280-5s.mp4',
    desc: 'Native portrait testsrc2 720x1280 30 fps 5 s; H.264 2 Mb/s + AAC 96k',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=5', ...sine(5, 500), ...x264(2000), ...aac(96), '-shortest', o]],
  },
  {
    id: 'F08', file: 'f08-hevc-1080p30-10s.mov',
    desc: 'HEVC (hvc1) 1920x1080 30 fps 10 s in MOV; libx265 4 Mb/s + AAC 128k',
    steps: (o) => [[
      '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=10', ...sine(10, 520),
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-b:v', '4000k',
      '-x265-params', 'log-level=error:vbv-maxrate=4000:vbv-bufsize=4000:strict-cbr=1:hrd=1',
      ...aac(128), '-shortest', '-f', 'mov', o,
    ]],
  },
  {
    id: 'F09', file: 'f09-vp9-720p30-10s.webm',
    desc: 'VP9 + Opus WebM 1280x720 30 fps 10 s; 2 Mb/s + 96k',
    steps: (o) => [[
      '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=10', ...sine(10, 400),
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '2000k', '-minrate', '2000k', '-maxrate', '2000k',
      '-c:a', 'libopus', '-b:a', '96k', '-shortest', o,
    ]],
  },
  {
    id: 'F10', file: 'f10-noaudio-720p30-10s.mp4',
    desc: 'No audio track: testsrc2 1280x720 30 fps 10 s; H.264 3 Mb/s',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=10', ...x264(3000), '-an', o]],
  },
  {
    id: 'F11', file: 'f11-long-360p30-300s.mp4',
    desc: 'Long low-res: testsrc2 640x360 30 fps 5 min; H.264 300 kb/s + AAC 48k mono',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=300', ...sine(300, 350), ...x264(300), ...aac(48, 1), '-shortest', o]],
  },
  {
    id: 'F12', file: 'f12-tiny-360p-5s.mp4',
    desc: 'Tiny, already under every target: 640x360 30 fps 5 s; H.264 500 kb/s + AAC 64k',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=5', ...sine(5), ...x264(500), ...aac(64), '-shortest', o]],
  },
  {
    id: 'F13', file: 'f13-hdr-pq-hevc-1080p-5s.mov',
    desc: 'HDR10-tagged HEVC Main10 (BT.2020 / PQ) 1920x1080 30 fps 5 s in MOV; 5 Mb/s + AAC 128k',
    steps: (o) => [[
      '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=5', ...sine(5, 610),
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-b:v', '5000k',
      '-x265-params', 'log-level=error:vbv-maxrate=5000:vbv-bufsize=5000:strict-cbr=1:hrd=1',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      ...aac(128), '-shortest', '-f', 'mov', o,
    ]],
  },
  {
    id: 'F14', file: 'f14-perf-1080p30-60s.mp4',
    desc: 'Perf clip: testsrc2 1920x1080 30 fps 60 s; H.264 3 Mb/s + AAC 128k',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=60', ...sine(60, 440), ...x264(3000), ...aac(128), '-shortest', o]],
  },
  {
    id: 'F15', file: 'f15-mpeg2-240p-2s.mpg',
    desc: 'MPEG-2 320x240 25 fps 2 s in MPEG-PS (web: unsupported; CLI: decodes)',
    steps: (o) => [['-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=2', ...sine(2), '-c:v', 'mpeg2video', '-b:v', '600k', '-c:a', 'mp2', '-b:a', '128k', '-shortest', '-f', 'mpeg', o]],
  },
  {
    id: 'F16', file: 'f16-audio-only.m4a',
    desc: 'Audio only: 5 s sine AAC in M4A (unsupported: no video track)',
    steps: (o) => [[...sine(5), ...aac(96), '-f', 'ipod', o]],
  },
  {
    id: 'F17', file: 'f17-not-video.mp4',
    desc: '64 KB of deterministic pseudo-random bytes named .mp4 (unsupported)',
    steps: () => [{
      node: (o) => {
        const buf = Buffer.alloc(65536);
        let s = 12345;
        for (let i = 0; i < buf.length; i++) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          buf[i] = s >> 16;
        }
        writeFileSync(o, buf);
      },
    }],
  },
];

function ffmpeg(args) {
  const out = args.at(-1);
  const full = ['-hide_banner', '-loglevel', 'error', '-y', ...args.slice(0, -1), ...BITEXACT, '-threads', '4', out];
  const r = spawnSync(FF, full, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${full.join(' ')}`);
}

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const only = argv.filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());
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
  const selected = !only.length || only.includes(fx.id);
  if (selected && (!existsSync(out) || force)) {
    const t0 = Date.now();
    const ext = fx.file.slice(fx.file.lastIndexOf('.'));
    const partial = out.slice(0, -ext.length) + '.partial' + ext;
    for (const step of fx.steps(partial)) {
      if (Array.isArray(step)) ffmpeg(step);
      else if ('node' in step) step.node(partial);
      else if ('cleanup' in step) rmSync(step.cleanup, { force: true });
    }
    renameSync(partial, out);
    console.log(`made ${fx.id} ${fx.file} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  if (existsSync(out)) {
    const bytes = statSync(out).size;
    total += bytes;
    manifest.push({ id: fx.id, file: fx.file, bytes, desc: fx.desc });
  }
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ totalBytes: total, fixtures: manifest }, null, 2) + '\n');
for (const m of manifest) console.log(`${m.id}  ${String(m.bytes).padStart(10)}  ${m.file}`);
console.log(`     ${String(total).padStart(10)}  total (${(total / 1e6).toFixed(1)} MB)`);
if (total > 100e6) {
  console.error('fixtures exceed the 100 MB budget');
  process.exit(1);
}

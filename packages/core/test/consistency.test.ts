// D1: the web app and the CLI choose the same plan for the same probe. Feeds recorded probes
// (fixtures/probes, from ffprobe via `snugclip probe --json`) to both engines' recorded capability
// sets (fixtures/caps/{web-chrome,ffmpeg-full}.json) and compares the plan fields ACCEPTANCE D1
// names. Engine margins differ (web 0.04, ffmpeg x264 0.02); decisions use TUNING.planMargin, so
// only the requested bitrate may differ.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MB, PRESETS, isNativeAacSafe, minimumBytes, plan, type CodecChoice, type EngineCapabilities, type Probe, type VideoCodecId } from '../src/index.js';

const dir = join(import.meta.dirname, 'fixtures');
const probes = readdirSync(join(dir, 'probes'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, 'probes', f), 'utf8')) as { fixture: string; file: string; probe: Probe });
const load = (name: string) => JSON.parse(readFileSync(join(dir, 'caps', `${name}.json`), 'utf8'));

function webCaps(): EngineCapabilities {
  const j = load('web-chrome');
  const tiers = j.encodeTiers as Record<VideoCodecId, number[]>;
  const r = j.aacRouting as { native: boolean; wasmAvailable: boolean; nativeFailed: boolean };
  return {
    ...j,
    canEncode: (codec: VideoCodecId, w: number, h: number) => {
      const short = Math.min(w, h);
      const long = Math.max(w, h);
      return (tiers[codec] ?? []).some((t) => short <= t && long <= (t * 16) / 9 + 1);
    },
    canEncodeAudio: (codec, b, ch, sr) => codec !== 'aac' || (r.native && !r.nativeFailed && isNativeAacSafe(b, ch, sr)) || r.wasmAvailable,
  };
}
function ffmpegCaps(): EngineCapabilities {
  return { ...load('ffmpeg-full'), canEncode: () => true };
}

const web = webCaps();
const cli = ffmpegCaps();
const presetBytes = [...new Set(PRESETS.map((p) => p.bytes))];

function targetsFor(p: Probe): number[] {
  const t = new Set<number>([8 * MB, 10 * MB, 25 * MB, ...presetBytes]);
  for (const f of [0.5, 0.25, 0.1]) t.add(Math.round(p.sizeBytes * f));
  const min = minimumBytes(p, {}, cli);
  for (const f of [1.05, 0.95]) t.add(Math.round(min * f));
  return [...t].filter((b) => b >= 10_000).sort((a, b) => a - b);
}

const fields = (x: ReturnType<typeof plan>) => ({
  feasible: x.feasible,
  passThrough: x.passThrough,
  container: x.container,
  video: x.video && { codec: x.video.codec, width: x.video.width, height: x.video.height, fps: x.video.fps, bppTier: x.video.bppTier },
  audioMode: x.audio.mode,
  minimumBytes: x.minimumBytes,
});

describe('D1: same plan for the same probe (web-chrome vs ffmpeg-full capabilities)', () => {
  it('has recorded probes for F01–F14', () => {
    expect(probes.map((p) => p.fixture)).toEqual(['f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10', 'f11', 'f12', 'f13', 'f14']);
  });
  for (const codec of ['compatible', 'smaller', 'vp9'] as CodecChoice[]) {
    it.each(probes.map((p) => [p.fixture, p] as const))(`${codec}: %s`, (_id, { probe }) => {
      let compared = 0;
      for (const T of targetsFor(probe)) {
        const target = { bytes: T, label: 'x' };
        const a = plan(probe, target, { codec }, web);
        const b = plan(probe, target, { codec }, cli);
        expect(fields(a), `${_id} @ ${T}`).toEqual(fields(b));
        compared++;
      }
      expect(compared).toBeGreaterThan(10);
    });
  }
  it('end to end: the web probe (mediabunny) and the CLI probe (ffprobe) give the same plans', () => {
    const diffs: string[] = [];
    for (const { fixture, probe } of probes) {
      const wp = (JSON.parse(readFileSync(join(dir, 'probes-web', `${fixture}.json`), 'utf8')) as { probe: Probe }).probe;
      for (const T of targetsFor(probe)) {
        const a = fields(plan(wp, { bytes: T, label: 'x' }, {}, web));
        const b = fields(plan(probe, { bytes: T, label: 'x' }, {}, cli));
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${fixture}@${T}: web ${JSON.stringify(a)} cli ${JSON.stringify(b)}`);
      }
    }
    expect(diffs).toEqual([]);
  });
  it('only the requested bitrate reflects the engine margin', () => {
    const { probe } = probes.find((p) => p.fixture === 'f14')!;
    const a = plan(probe, { bytes: 10 * MB, label: 'x' }, {}, web);
    const b = plan(probe, { bytes: 10 * MB, label: 'x' }, {}, cli);
    expect(a.video!.bitrate).toBeLessThan(b.video!.bitrate);
    expect(a.marginBytes).toBe(400_000);
    expect(b.marginBytes).toBe(200_000);
  });
});

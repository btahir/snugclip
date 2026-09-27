// A1: planner goldens over durations × targets × sources × codecs × audio (PLAN §4, ACCEPTANCE A1).
// Regenerate only with `vitest -u` after a reviewed PLAN change.
import { describe, expect, it } from 'vitest';
import { MB, plan, type Probe } from '../src/index.js';
import { CODECS, makeProbe, testCaps } from './fake-engine.js';

const durations = [3, 15, 60, 300, 1800];
const targets = [1, 8, 10, 14.5, 18, 20, 25, 50, 100, 500].map((n) => Math.round(n * MB));
const sources: [string, Parameters<typeof makeProbe>[0]][] = [
  ['3840x2160@60', { width: 3840, height: 2160, fps: 60 }],
  ['1920x1080@30', { width: 1920, height: 1080, fps: 30 }],
  ['1280x720@60', { width: 1280, height: 720, fps: 60 }],
  ['1080x1920@30-rot90', { width: 1920, height: 1080, fps: 30, rotation: 90 }],
  ['640x360@30', { width: 640, height: 360, fps: 30 }],
  ['320x180@15', { width: 320, height: 180, fps: 15 }],
];
const audios: [string, Probe['audio']][] = [
  ['aac128', { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 128_000, decodable: true }],
  ['noaudio', null],
];

describe('planner goldens', () => {
  for (const codec of CODECS) {
    for (const [aName, audio] of audios) {
      it(`${codec} / ${aName}`, async () => {
        const rows: Record<string, unknown>[] = [];
        for (const [sName, s] of sources) {
          for (const d of durations) {
            for (const t of targets) {
              const p = plan(makeProbe({ ...s, durationSec: d, audio }), { bytes: t, label: 'x' }, { codec }, testCaps());
              rows.push({
                case: `${sName} ${d}s ${t / MB}MB`,
                feasible: p.feasible,
                rung: p.video ? `${p.video.width}x${p.video.height}` : null,
                fps: p.video?.fps ?? null,
                videoBitrate: p.video?.bitrate ?? null,
                audioMode: p.audio.mode,
                audioBitrate: p.audio.bitrate ?? null,
                channels: p.audio.channels ?? null,
                bppTier: p.video?.bppTier ?? null,
                keyframeIntervalSec: p.video?.keyframeIntervalSec ?? null,
                minimumBytes: p.minimumBytes,
              });
            }
          }
        }
        await expect(JSON.stringify(rows, null, 1) + '\n').toMatchFileSnapshot(`./golden/plan/${codec}-${aName}.json`);
      });
    }
  }
});

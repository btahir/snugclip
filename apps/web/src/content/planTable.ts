// Computes "what this size buys" tables from the real planner, so page copy can't drift from
// the product. Uses a typical WebCodecs capability set (H.264 + AAC, one-pass).
import { plan, type EngineCapabilities, type Probe } from '@snugclip/core';

export const TYPICAL_WEB_CAPS: EngineCapabilities = {
  id: 'web',
  version: 'typical',
  encoderName: { h264: 'webcodecs' },
  videoCodecs: ['h264', 'vp9'],
  audioCodecs: ['aac', 'opus'],
  containers: ['mp4', 'webm'],
  twoPass: false,
  initialMargin: 0.04,
  rateCalibration: 'always',
  audioCopyWithTrim: false,
  maxEncodeShortSide: {},
  canEncode: () => true,
};

export interface PlanRow {
  durationSec: number;
  feasible: boolean;
  resolution: string;
  fps: number;
  videoKbps: number;
  audioKbps: number;
  minimumBytes: number;
}

function probeFor(durationSec: number): Probe {
  return {
    container: 'mp4',
    sizeBytes: Math.round(durationSec * 12_000_000 / 8),
    durationSec,
    video: { codec: 'h264', decodable: true, codedWidth: 1920, codedHeight: 1080, displayWidth: 1920, displayHeight: 1080, rotation: 0, fps: 30, bitrate: 11_800_000, hdr: false },
    audio: { codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 160_000, decodable: true },
  };
}

export function planTable(bytes: number, durations = [30, 60, 120, 300]): PlanRow[] {
  return durations.map((d) => {
    const p = plan(probeFor(d), { bytes, label: '' }, { reencode: true }, TYPICAL_WEB_CAPS);
    return {
      durationSec: d,
      feasible: p.feasible,
      resolution: p.video ? `${Math.min(p.video.width, p.video.height)}p` : '—',
      fps: p.video ? Math.round(p.video.fps) : 0,
      videoKbps: p.video ? Math.round(p.video.bitrate / 1000) : 0,
      audioKbps: p.audio.bitrate ? Math.round(p.audio.bitrate / 1000) : 0,
      minimumBytes: p.minimumBytes,
    };
  });
}

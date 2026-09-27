// Real audio-encoder probe. `AudioEncoder.isConfigSupported` lies on some platforms: Chrome on
// macOS says every AAC config is supported but fails to encode below ~48 kbps mono / ~96 kbps
// stereo. So at capability time we encode 20 frames of a tone for each ladder config and keep the
// ones that produced output. Browser-only; `audioConfigKey` and `makeCanEncodeAudio` are pure.
import { TUNING, type AudioCodecId, type EngineCapabilities } from '@snugclip/core';

export const audioConfigKey = (codec: AudioCodecId, bitrate: number, channels: 1 | 2, sampleRate: number) => `${codec}:${Math.round(bitrate)}:${channels}:${sampleRate}`;

/** Sync canEncodeAudio over the probed set; null set = no constraint known (everything allowed). */
export function makeCanEncodeAudio(ok: ReadonlySet<string> | null): EngineCapabilities['canEncodeAudio'] {
  return (codec, bitrate, channels, sampleRate) => !ok || ok.has(audioConfigKey(codec, bitrate, channels, sampleRate));
}

const WEBCODECS_ID: Record<AudioCodecId, string> = { aac: 'mp4a.40.2', opus: 'opus' };

async function encodesOk(codec: AudioCodecId, bitrate: number, channels: 1 | 2, sampleRate: number): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false;
  let outputs = 0;
  let failed = false;
  const enc = new AudioEncoder({ output: () => void outputs++, error: () => void (failed = true) });
  try {
    enc.configure({ codec: WEBCODECS_ID[codec], bitrate, numberOfChannels: channels, sampleRate });
    const frames = codec === 'opus' ? 960 : 1024;
    for (let i = 0; i < 20; i++) {
      const data = new Float32Array(frames * channels);
      for (let j = 0; j < data.length; j++) data[j] = Math.sin((i * frames + j) / 7) * 0.3;
      enc.encode(new AudioData({ format: 'f32', sampleRate, numberOfFrames: frames, numberOfChannels: channels, timestamp: Math.round(((i * frames) / sampleRate) * 1e6), data }));
    }
    await enc.flush();
  } catch {
    failed = true;
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
  return !failed && outputs > 0;
}

/** Encodes a short tone for every ladder config of the given native codecs; returns the keys that work. */
export async function probeAudioConfigs(codecs: AudioCodecId[]): Promise<Set<string>> {
  const ok = new Set<string>();
  const jobs: Promise<void>[] = [];
  for (const codec of codecs) {
    const rates = codec === 'opus' ? [48000] : [44100, 48000];
    for (const kbps of TUNING.audioLadder[codec]) {
      for (const ch of [1, 2] as const) {
        for (const sr of rates) {
          jobs.push(encodesOk(codec, kbps * 1000, ch, sr).then((good) => void (good && ok.add(audioConfigKey(codec, kbps * 1000, ch, sr)))));
        }
      }
    }
  }
  await Promise.all(jobs);
  return ok;
}

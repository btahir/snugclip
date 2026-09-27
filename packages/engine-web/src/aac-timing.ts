// Native AAC timing fix (verifier V1). Chrome's WebCodecs AAC encoder emits its encoder delay
// ("priming", 2112 samples on macOS/AudioToolbox; measured in headless Chrome 154: an impulse at
// 0.5 s decodes 2112(+6 filter) samples late at 44.1 and 48 kHz, 96–128 kbps, mono and stereo) as
// ordinary audio starting at timestamp 0. mediabunny writes an MP4 edit list only for negative
// timestamps, so the priming became content: audio ran ~44 ms late and the file 69–91 ms long.
// The engine re-muxes such outputs (no re-encode): audio packets shift back by the priming, so the
// muxer writes an edit list that hides it, and packets ending after the video are dropped.
// This file holds the pure decision; the re-mux lives in encode.ts.

export const NATIVE_AAC_PRIMING_SAMPLES = 2112;

export interface PacketTiming {
  timestamp: number;
  duration: number;
}

export interface AacRetime {
  /** Seconds to subtract from every audio timestamp (0 when the encoder already signalled priming). */
  shiftSec: number;
  /** Number of leading audio packets to keep (the rest end after the video). */
  keep: number;
  /** Whether anything changes (otherwise the output is left as is). */
  changed: boolean;
}

/**
 * Decides the audio re-timing. Packets are in decode order (AAC: also presentation order). After
 * the shift, a packet is kept when it ends no later than the video end (+1 ms), so audio ends at
 * most one packet (~21 ms) before the video and never after it.
 */
export function planAacRetime(audio: readonly PacketTiming[], sampleRate: number, videoEndSec: number, primingSamples: number = NATIVE_AAC_PRIMING_SAMPLES): AacRetime {
  if (!audio.length || !(sampleRate > 0)) return { shiftSec: 0, keep: audio.length, changed: false };
  const shiftSec = audio[0]!.timestamp > -1e-6 ? primingSamples / sampleRate : 0;
  let keep = audio.length;
  while (keep > 0) {
    const p = audio[keep - 1]!;
    if (p.timestamp - shiftSec + p.duration <= videoEndSec + 1e-3) break;
    keep--;
  }
  return { shiftSec, keep, changed: shiftSec > 0 || keep < audio.length };
}

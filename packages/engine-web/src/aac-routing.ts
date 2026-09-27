// Which AAC encoder handles a config (native WebCodecs vs the WASM @mediabunny/aac-encoder).
//
// Native AAC is used only on the TUNING.nativeAacSafe allowlist (≥ 96 kbps at 44.1/48 kHz, mono or
// stereo): lower-bitrate native AAC aborts Chromium's GPU process on macOS 27 (see core tuning.ts).
// There is no speculative encoding anywhere: native support is read from isConfigSupported only,
// and everything below the allowlist goes to WASM. After a native AAC failure mid-encode, the
// engine flips `nativeFailed` and sends every later AAC encode to WASM. Pure; unit-tested.
import { isNativeAacSafe, type EngineCapabilities } from '@snugclip/core';

export interface AacRouting {
  /** The browser reports a native AAC encoder (AudioEncoder.isConfigSupported). */
  native: boolean;
  /** The app gave an aacEncoderUrl and the WASM encoder hasn't failed to load. */
  wasmAvailable: boolean;
  /** A native AAC encode failed in this session: stop using native AAC. */
  nativeFailed: boolean;
}

/** True when this AAC config must use the WASM encoder. */
export function aacNeedsWasm(r: AacRouting, bitrate: number, channels: number, sampleRate: number): boolean {
  return !r.native || r.nativeFailed || !isNativeAacSafe(bitrate, channels, sampleRate);
}

/** Sync canEncodeAudio for the planner: AAC configs are encodable natively (allowlist) or via WASM. */
export function makeCanEncodeAudio(r: AacRouting): NonNullable<EngineCapabilities['canEncodeAudio']> {
  return (codec, bitrate, channels, sampleRate) => {
    if (codec !== 'aac') return true;
    if (!aacNeedsWasm(r, bitrate, channels, sampleRate)) return true;
    return r.wasmAvailable;
  };
}

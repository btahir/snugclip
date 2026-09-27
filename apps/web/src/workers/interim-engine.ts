// INTERIM web engine: used only until @snugclip/engine-web (Builder A) exports its Engine.
// It implements core's Engine<Blob, Blob> (PLAN §4.9) with mediabunny (MPL-2.0, unmodified)
// so the UI can run real WebCodecs compressions end to end in the meantime. `engine.ts`
// prefers engine-web whenever it is available; delete this file once engine-web is final.
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import {
  SnugclipError,
  type AbortSignalLike,
  type AudioCodecId,
  type EncodePlan,
  type EncodeProgress,
  type EncodeResult,
  type Engine,
  type EngineCapabilities,
  type LumaFrame,
  type Probe,
  type VideoCodecId,
} from '@snugclip/core';

const MB_CODEC: Record<VideoCodecId, 'avc' | 'hevc' | 'av1' | 'vp9'> = { h264: 'avc', hevc: 'hevc', av1: 'av1', vp9: 'vp9' };
const norm = (c: string | null | undefined) => (!c ? 'unknown' : c === 'avc' ? 'h264' : c);
const cancelled = () => new SnugclipError('E_CANCELLED', 'Cancelled.');

function open(blob: Blob): Input {
  return new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
}

export async function probeBlob(blob: Blob): Promise<Probe> {
  const input = open(blob);
  try {
    let formatName: string;
    try {
      formatName = (await input.getFormat()).name.toLowerCase();
    } catch {
      throw new SnugclipError('E_UNSUPPORTED', "This file isn't a video container Snugclip can read.");
    }
    const container = /mp4/.test(formatName) ? 'mp4' : /quicktime|mov/.test(formatName) ? 'mov' : /webm/.test(formatName) ? 'webm' : /matroska|mkv/.test(formatName) ? 'mkv' : formatName;
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    const durationSec = await input.computeDuration();
    let video: Probe['video'] = null;
    if (vt) {
      const [codec, cw, ch, dw, dh, rot, hdr, decodable] = await Promise.all([
        vt.getCodec(),
        vt.getCodedWidth(),
        vt.getCodedHeight(),
        vt.getDisplayWidth(),
        vt.getDisplayHeight(),
        vt.getRotation(),
        vt.hasHighDynamicRange().catch(() => false),
        vt.canDecode().catch(() => false),
      ]);
      let fps = 30;
      let bitrate: number | undefined;
      try {
        const s = await vt.computePacketStats(240);
        if (s.averagePacketRate > 0) fps = s.averagePacketRate;
        bitrate = Math.round(s.averageBitrate) || undefined;
      } catch {
        /* defaults */
      }
      try {
        const m = (await vt.computeFrameRateMetrics()) as { bestGuessFrameRate?: number | null };
        if (m.bestGuessFrameRate && m.bestGuessFrameRate > 0) fps = m.bestGuessFrameRate;
      } catch {
        /* keep packet rate */
      }
      video = {
        codec: norm(codec),
        decodable,
        codedWidth: cw,
        codedHeight: ch,
        displayWidth: dw,
        displayHeight: dh,
        rotation: (((rot % 360) + 360) % 360) as 0 | 90 | 180 | 270,
        fps: Math.round(fps * 1000) / 1000,
        ...(bitrate ? { bitrate } : {}),
        hdr,
      };
    }
    let audio: Probe['audio'] = null;
    if (at) {
      let abr: number | undefined;
      try {
        abr = Math.round((await at.computePacketStats(200)).averageBitrate) || undefined;
      } catch {
        /* unknown */
      }
      audio = {
        codec: norm(await at.getCodec()),
        channels: await at.getNumberOfChannels(),
        sampleRate: await at.getSampleRate(),
        ...(abr ? { bitrate: abr } : {}),
        decodable: await at.canDecode().catch(() => false),
      };
    }
    return { container, sizeBytes: blob.size, durationSec, video, audio };
  } finally {
    input.dispose();
  }
}

/** RGBA frames nearest to each time, scaled so the short side is `shortSide`. */
export async function framesOf(blob: Blob, timesSec: number[], shortSide: number, signal?: AbortSignalLike): Promise<LumaFrame[]> {
  const input = open(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new SnugclipError('E_UNSUPPORTED', 'No video track.');
    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const s = shortSide / Math.min(dw, dh);
    const width = Math.max(2, Math.round((dw * s) / 2) * 2);
    const height = Math.max(2, Math.round((dh * s) / 2) * 2);
    const sink = new CanvasSink(track, { width, height, fit: 'fill' });
    const out: LumaFrame[] = [];
    const first = await track.getFirstTimestamp().catch(() => 0);
    for await (const wc of sink.canvasesAtTimestamps(timesSec.map((t) => Math.max(first, t)))) {
      if (signal?.aborted) throw cancelled();
      if (!wc) continue;
      const ctx = (wc.canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
      out.push({ width, height, data: ctx.getImageData(0, 0, width, height).data });
    }
    return out;
  } finally {
    input.dispose();
  }
}

export class InterimWebEngine implements Engine<Blob, Blob> {
  readonly id = 'web' as const;
  private caps: EngineCapabilities | null = null;
  private pauseCtl: AbortController | null = null;
  private paused = false;
  private waiters: (() => void)[] = [];

  probe(input: Blob): Promise<Probe> {
    return probeBlob(input);
  }

  async capabilities(): Promise<EngineCapabilities> {
    if (this.caps) return this.caps;
    const sizes = [
      [3840, 2160],
      [1920, 1080],
      [1280, 720],
    ] as const;
    const videoCodecs: VideoCodecId[] = [];
    const maxEncodeShortSide: Partial<Record<VideoCodecId, number>> = {};
    for (const c of ['h264', 'hevc', 'av1', 'vp9'] as VideoCodecId[]) {
      for (const [w, h] of sizes) {
        try {
          if (await canEncodeVideo(MB_CODEC[c], { width: w, height: h, bitrate: 2_000_000 })) {
            if (!videoCodecs.includes(c)) videoCodecs.push(c);
            maxEncodeShortSide[c] = Math.max(maxEncodeShortSide[c] ?? 0, h);
          }
        } catch {
          /* not encodable at this size */
        }
      }
    }
    const audioCodecs: AudioCodecId[] = [];
    for (const c of ['aac', 'opus'] as AudioCodecId[]) {
      try {
        if (await canEncodeAudio(c, { numberOfChannels: 2, sampleRate: 48000, bitrate: 128_000 })) audioCodecs.push(c);
      } catch {
        /* no */
      }
    }
    const containers: EngineCapabilities['containers'] = [];
    if (videoCodecs.some((c) => c !== 'vp9')) containers.push('mp4');
    if (videoCodecs.includes('vp9')) containers.push('webm');
    this.caps = {
      id: 'web',
      version: 'interim-mediabunny-1.60',
      encoderName: Object.fromEntries(videoCodecs.map((c) => [c, `webcodecs:${MB_CODEC[c]}`])),
      videoCodecs,
      audioCodecs,
      containers,
      twoPass: false,
      initialMargin: 0.04,
      rateCalibration: 'always',
      audioCopyWithTrim: false,
      maxEncodeShortSide,
      canEncode: (codec, w, h) => videoCodecs.includes(codec) && Math.min(w, h) <= (maxEncodeShortSide[codec] ?? 0),
    };
    return this.caps;
  }

  pause(): void {
    this.paused = true;
    this.pauseCtl?.abort();
  }

  resume(): void {
    this.paused = false;
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private waitResume(): Promise<void> {
    return this.paused ? new Promise((r) => this.waiters.push(r)) : Promise.resolve();
  }

  async encode(plan: EncodePlan<Blob>, opts: { signal: AbortSignalLike; onProgress?: (p: EncodeProgress) => void }): Promise<EncodeResult<Blob>> {
    const { signal } = opts;
    if (signal.aborted) throw cancelled();
    const input = open(plan.input);
    const target = new BufferTarget();
    const output = new Output({
      format: plan.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    const v = plan.video;
    const a = plan.audio;
    const trim = plan.trim ? { start: plan.trim.startSec, end: plan.trim.endSec } : undefined;
    const D = trim ? trim.end - trim.start : await input.computeDuration();
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      ...(trim ? { trim } : {}),
      video: {
        width: v.width,
        height: v.height,
        fit: 'fill',
        frameRate: v.fps,
        codec: MB_CODEC[v.codec],
        bitrate: v.bitrate,
        keyFrameInterval: v.keyframeIntervalSec,
        forceTranscode: true,
        hardwareAcceleration: 'no-preference',
      },
      audio:
        a.mode === 'none'
          ? { discard: true }
          : a.mode === 'copy'
            ? {}
            : { codec: a.codec!, bitrate: a.bitrate!, numberOfChannels: a.channels!, sampleRate: a.sampleRate!, forceTranscode: true },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
      throw new SnugclipError('E_UNSUPPORTED', `This browser can't make this output (${why || 'invalid conversion'}).`);
    }
    const onAbort = () => void conversion.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    conversion.onProgress = (p) => opts.onProgress?.({ fraction: Math.max(0, Math.min(1, p)), encodedSec: p * D });
    try {
      for (;;) {
        await this.waitResume();
        if (signal.aborted) throw cancelled();
        this.pauseCtl = new AbortController();
        await conversion.execute({ pauseSignal: this.pauseCtl.signal });
        if (conversion.state === 'done') break;
      }
    } catch (e) {
      if (e instanceof ConversionCanceledError || signal.aborted) throw cancelled();
      throw e;
    } finally {
      this.pauseCtl = null;
      signal.removeEventListener('abort', onAbort);
      input.dispose();
    }
    const buf = target.buffer!;
    return {
      output: new Blob([buf], { type: plan.container === 'webm' ? 'video/webm' : 'video/mp4' }),
      bytes: buf.byteLength,
      durationSec: D,
      encoder: `webcodecs:${MB_CODEC[v.codec]}`,
    };
  }

  frames(src: Blob, timesSec: number[], evalShortSide: number, signal: AbortSignalLike): Promise<LumaFrame[]> {
    return framesOf(src, timesSec, evalShortSide, signal);
  }

  async passThrough(input: Blob): Promise<Blob> {
    return input;
  }

  async commit(output: Blob): Promise<Blob> {
    return output;
  }

  async discard(): Promise<void> {
    /* Blobs are garbage-collected once unreferenced */
  }
}

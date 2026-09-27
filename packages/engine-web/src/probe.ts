// Browser side of probe(): reads mediabunny track metadata into a RawProbe; probe-map.ts does
// the (tested) mapping to the core's Probe. Reads are lazy, so a 4 GB file is never loaded.
import type { AbortSignalLike, Probe } from '@snugclip/core';
import { SnugclipError, throwIfAborted } from '@snugclip/core';
import { ALL_FORMATS, BlobSource, Input, IsobmffInputFormat } from 'mediabunny';
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';
import { mapEngineError } from './errors-map.js';
import { buildProbe } from './probe-map.js';
import type { RawAudioTrack, RawVideoTrack } from './probe-map.js';

/** Packets inspected for bitrate/fps on formats without a cheap sample index. */
const PREFIX_PACKETS = 300;

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

async function rawVideo(t: InputVideoTrack, fullIndex: boolean): Promise<RawVideoTrack> {
  const stats = await safe(t.computePacketStats(fullIndex ? undefined : PREFIX_PACKETS), null);
  const fps = await safe(t.computeFrameRateMetrics(), null);
  const colorSpace = await safe(t.getColorSpace(), null);
  return {
    codec: await t.getCodec(),
    internalCodecId: await safe(t.getInternalCodecId(), null),
    codecString: await safe(t.getCodecParameterString(), null),
    codedWidth: await t.getCodedWidth(),
    codedHeight: await t.getCodedHeight(),
    displayWidth: await t.getDisplayWidth(),
    displayHeight: await t.getDisplayHeight(),
    rotation: await safe(t.getRotation(), 0),
    fps: fps?.bestGuessFrameRate ?? null,
    packetRate: stats?.averagePacketRate ?? null,
    frameCount: fullIndex ? (stats?.packetCount ?? null) : null,
    measuredBitrate: stats?.averageBitrate ?? null,
    metadataBitrate: await safe(t.getAverageBitrate(), null),
    hdr: await safe(t.hasHighDynamicRange(), false),
    colorSpace: colorSpace ? { primaries: colorSpace.primaries ?? null, transfer: colorSpace.transfer ?? null, matrix: colorSpace.matrix ?? null } : null,
    decodable: await safe(t.canDecode(), false),
  };
}

async function rawAudio(t: InputAudioTrack, fullIndex: boolean): Promise<RawAudioTrack> {
  const stats = await safe(t.computePacketStats(fullIndex ? undefined : PREFIX_PACKETS), null);
  return {
    codec: await t.getCodec(),
    internalCodecId: await safe(t.getInternalCodecId(), null),
    channels: await t.getNumberOfChannels(),
    sampleRate: await t.getSampleRate(),
    measuredBitrate: stats?.averageBitrate ?? null,
    metadataBitrate: await safe(t.getAverageBitrate(), null),
    decodable: await safe(t.canDecode(), false),
  };
}

export async function probeBlob(blob: Blob, signal?: AbortSignalLike): Promise<Probe> {
  throwIfAborted(signal);
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) {
      throw new SnugclipError('E_UNSUPPORTED', "This file's format can't be read in the browser.", {
        hint: 'Snugclip handles MP4, MOV, M4V, WebM and MKV. The CLI (ffmpeg) reads more formats.',
      });
    }
    const format = await input.getFormat();
    // MP4/MOV keep a sample index in the header, so whole-file packet stats are cheap there.
    const fullIndex = format instanceof IsobmffInputFormat;
    const [v, a] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    throwIfAborted(signal);
    const probe = buildProbe({
      formatName: format.name,
      sizeBytes: blob.size,
      durationSec: await input.computeDuration(),
      video: v ? await rawVideo(v, fullIndex) : null,
      audio: a ? await rawAudio(a, fullIndex) : null,
    });
    throwIfAborted(signal);
    return probe;
  } catch (e) {
    throw mapEngineError(e, signal, 'probe');
  } finally {
    input.dispose();
  }
}

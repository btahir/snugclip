// ffprobe JSON → core Probe (PLAN §8.1). Pure, so it's unit-tested without ffmpeg.
import { SnugclipError, type Probe } from '@snugclip/core';

export interface FfprobeStream {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  coded_width?: number;
  coded_height?: number;
  sample_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  nb_frames?: string;
  duration?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  color_primaries?: string;
  channels?: number;
  sample_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
}

export interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string; size?: string; bit_rate?: string; tags?: Record<string, string> };
}

const IMAGE_FORMATS = /(^|,)(image2|png_pipe|jpeg_pipe|webp_pipe|gif|bmp_pipe|tiff_pipe|apng)(,|$)/;

export function parseRate(r: string | undefined): number {
  if (!r) return 0;
  const [n, d] = r.split('/').map(Number);
  if (!n || !Number.isFinite(n)) return 0;
  return d ? Math.round((n / d) * 1000) / 1000 : n;
}

const num = (s: string | undefined) => {
  const n = s === undefined ? NaN : Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** ffprobe's displaymatrix rotation is CCW (may be negative); the core wants CW 0/90/180/270. */
export function clockwiseRotation(s: FfprobeStream): 0 | 90 | 180 | 270 {
  const sd = s.side_data_list?.find((d) => typeof d.rotation === 'number');
  let cw: number;
  if (sd && typeof sd.rotation === 'number') cw = (360 - (((sd.rotation % 360) + 360) % 360)) % 360;
  else if (s.tags?.rotate) cw = ((Number(s.tags.rotate) % 360) + 360) % 360; // legacy tag is CW
  else cw = 0;
  const snapped = (Math.round(cw / 90) * 90) % 360;
  return snapped as 0 | 90 | 180 | 270;
}

export function containerName(formatName: string | undefined, path: string, majorBrand?: string): string {
  const f = formatName ?? '';
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (f.includes('mov') && f.includes('mp4')) {
    if (majorBrand?.trim() === 'qt' || ext === 'mov') return 'mov';
    if (ext === 'm4v') return 'm4v';
    return 'mp4';
  }
  if (f.includes('matroska') || f.includes('webm')) return ext === 'webm' ? 'webm' : 'mkv';
  return f.split(',')[0] || 'unknown';
}

/** Maps ffprobe output. Throws E_UNSUPPORTED for audio-only, image and unreadable inputs. */
export function mapFfprobe(json: FfprobeJson, path: string, sizeBytes: number): Probe {
  const fmt = json.format ?? {};
  const streams = json.streams ?? [];
  if (IMAGE_FORMATS.test(fmt.format_name ?? '')) {
    throw new SnugclipError('E_UNSUPPORTED', 'This looks like an image, not a video.', { hint: 'Snugclip compresses videos (MP4, MOV, M4V, WebM, MKV and more via ffmpeg).' });
  }
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new SnugclipError('E_UNSUPPORTED', a ? 'This file has only audio, no video track.' : 'No video track found in this file.', { hint: 'Snugclip compresses videos (MP4, MOV, M4V, WebM, MKV).' });
  const duration = num(fmt.duration) ?? num(v.duration);
  if (!duration) throw new SnugclipError('E_UNSUPPORTED', "Couldn't read this video's duration.");
  const w = v.width ?? 0;
  const h = v.height ?? 0;
  if (!(w > 0 && h > 0)) throw new SnugclipError('E_UNSUPPORTED', "Couldn't read this video's dimensions.");
  const rotation = clockwiseRotation(v);
  const [sn, sd] = (v.sample_aspect_ratio ?? '1:1').split(':').map(Number);
  const sar = sn && sd ? sn / sd : 1;
  let dw = Math.round(w * sar);
  let dh = h;
  dw += dw % 2;
  if (rotation === 90 || rotation === 270) [dw, dh] = [dh, dw];
  const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 30;
  const transfer = v.color_transfer;
  const bitDepth = num(v.bits_per_raw_sample) ?? (/(p10|p12|10le|12le)/.test(v.pix_fmt ?? '') ? (/12/.test(v.pix_fmt ?? '') ? 12 : 10) : undefined);
  const video: NonNullable<Probe['video']> = {
    codec: v.codec_name ?? 'unknown',
    decodable: !!v.codec_name && v.codec_name !== 'none',
    codedWidth: v.coded_width || w,
    codedHeight: v.coded_height || h,
    displayWidth: dw,
    displayHeight: dh,
    rotation,
    fps,
    hdr: transfer === 'smpte2084' || transfer === 'arib-std-b67',
  };
  const frames = num(v.nb_frames);
  if (frames) video.frameCount = Math.round(frames);
  const vb = num(v.bit_rate);
  if (vb) video.bitrate = Math.round(vb);
  if (transfer) video.transfer = transfer;
  if (v.color_primaries) video.primaries = v.color_primaries;
  if (bitDepth) video.bitDepth = bitDepth;
  let audio: Probe['audio'] = null;
  if (a) {
    audio = { codec: a.codec_name ?? 'unknown', channels: a.channels ?? 2, sampleRate: num(a.sample_rate) ?? 48000, decodable: !!a.codec_name };
    const ab = num(a.bit_rate);
    if (ab) audio.bitrate = Math.round(ab);
  }
  return { container: containerName(fmt.format_name, path, fmt.tags?.major_brand), sizeBytes, durationSec: duration, video, audio };
}

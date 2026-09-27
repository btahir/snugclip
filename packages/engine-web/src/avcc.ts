// avcC (AVCDecoderConfigurationRecord, ISO/IEC 14496-15 §5.3.3.1) validation and repair.
//
// Firefox's H.264 encoder on Windows (WMF) and Linux (FFmpeg) returns a malformed
// `decoderConfig.description`: wrong reserved bits and a duplicated NAL header byte at the start
// of each SPS/PPS (Bugzilla 2031056, NEW as of Firefox 149). mediabunny writes the description
// verbatim into the MP4, so Firefox plays its own file but ffmpeg, phones and chat-app transcoders
// reject it ("SPS decoding failure"). The engine checks every H.264 output (behaviour, not UA) and
// re-muxes with a rebuilt record when needed. Pure; unit-tested.

export interface AvcCParse {
  ok: boolean;
  problems: string[];
  sps: Uint8Array[];
  pps: Uint8Array[];
  lengthSize: number;
}

const nalType = (b: number) => b & 0x1f;

/** Parses leniently and reports every deviation from a well-formed record. */
export function validateAvcC(desc: Uint8Array): AvcCParse {
  const problems: string[] = [];
  const out: AvcCParse = { ok: false, problems, sps: [], pps: [], lengthSize: 4 };
  if (desc.length < 7) {
    problems.push('too short');
    return out;
  }
  if (desc[0] !== 1) problems.push(`configurationVersion ${desc[0]} (expected 1)`);
  if ((desc[4]! & 0xfc) !== 0xfc) problems.push('reserved bits before lengthSizeMinusOne not set');
  if ((desc[5]! & 0xe0) !== 0xe0) problems.push('reserved bits before numOfSequenceParameterSets not set');
  out.lengthSize = (desc[4]! & 0x03) + 1;
  let i = 6;
  const readSets = (count: number, type: number, label: string): Uint8Array[] | null => {
    const sets: Uint8Array[] = [];
    for (let n = 0; n < count; n++) {
      if (i + 2 > desc.length) {
        problems.push(`${label} ${n}: truncated length`);
        return null;
      }
      const len = (desc[i]! << 8) | desc[i + 1]!;
      i += 2;
      if (len === 0 || i + len > desc.length) {
        problems.push(`${label} ${n}: bad length ${len}`);
        return null;
      }
      const nal = desc.subarray(i, i + len);
      i += len;
      if (nalType(nal[0]!) !== type) problems.push(`${label} ${n}: NAL type ${nalType(nal[0]!)} (expected ${type})`);
      if (nal.length > 1 && nal[1] === nal[0]) problems.push(`${label} ${n}: duplicated NAL header byte`);
      sets.push(nal);
    }
    return sets;
  };
  const sps = readSets(desc[5]! & 0x1f, 7, 'SPS');
  if (sps) {
    out.sps = sps;
    if (!sps.length) problems.push('no SPS');
    if (i >= desc.length) problems.push('missing PPS count');
    else {
      const count = desc[i]!;
      i += 1;
      const pps = readSets(count, 8, 'PPS');
      if (pps) {
        out.pps = pps;
        if (!pps.length) problems.push('no PPS');
      }
    }
  }
  if (out.sps[0] && out.sps[0].length >= 4) {
    const s = out.sps[0][1] === out.sps[0][0] ? out.sps[0].subarray(1) : out.sps[0];
    if (s.length >= 4 && (desc[1] !== s[1] || desc[3] !== s[3])) problems.push('profile/level bytes disagree with the SPS');
  }
  out.ok = problems.length === 0;
  return out;
}

/** Splits an access unit into NAL units (Annex B start codes or `lengthSize`-byte length prefixes). */
export function splitNalUnits(data: Uint8Array, lengthSize = 4): Uint8Array[] {
  const annexB = data.length > 4 && data[0] === 0 && data[1] === 0 && (data[2] === 1 || (data[2] === 0 && data[3] === 1));
  const out: Uint8Array[] = [];
  if (annexB) {
    let start = -1;
    for (let i = 0; i + 2 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
        if (start >= 0) out.push(trimZeros(data.subarray(start, i)));
        start = i + 3;
        i += 2;
      }
    }
    if (start >= 0 && start < data.length) out.push(data.subarray(start));
    return out.filter((n) => n.length);
  }
  let i = 0;
  while (i + lengthSize <= data.length) {
    let len = 0;
    for (let k = 0; k < lengthSize; k++) len = len * 256 + data[i + k]!;
    i += lengthSize;
    if (len === 0 || i + len > data.length) break;
    out.push(data.subarray(i, i + len));
    i += len;
  }
  return out;
}

function trimZeros(n: Uint8Array): Uint8Array {
  let end = n.length;
  while (end > 0 && n[end - 1] === 0) end--;
  return n.subarray(0, end);
}

/** Builds a well-formed record (with the High-profile extension for profile_idc 100/110/122/144, 4:2:0 8-bit). */
export function buildAvcC(sps: Uint8Array[], pps: Uint8Array[], lengthSize = 4): Uint8Array {
  if (!sps.length || !pps.length) throw new Error('avcC needs at least one SPS and one PPS');
  const s0 = sps[0]!;
  const parts: number[] = [1, s0[1]!, s0[2]!, s0[3]!, 0xfc | ((lengthSize - 1) & 3), 0xe0 | (sps.length & 0x1f)];
  for (const s of sps) parts.push(s.length >> 8, s.length & 0xff, ...s);
  parts.push(pps.length & 0xff);
  for (const p of pps) parts.push(p.length >> 8, p.length & 0xff, ...p);
  if ([100, 110, 122, 144].includes(s0[1]!)) parts.push(0xfc | 1, 0xf8, 0xf8, 0);
  return Uint8Array.from(parts);
}

/** `avc1.PPCCLL` from an SPS. */
export function avcCodecString(sps: Uint8Array): string {
  const h = (b: number) => b.toString(16).padStart(2, '0');
  return `avc1.${h(sps[1]!)}${h(sps[2]!)}${h(sps[3]!)}`;
}

const dedupeHeader = (n: Uint8Array, type: number) => (n.length > 1 && n[0] === n[1] && nalType(n[0]!) === type ? n.subarray(1) : n);

/**
 * Returns a repaired record, or null when `desc` is already well formed. Prefers the SPS/PPS
 * carried in-band in the first keyframe; otherwise fixes the record's own sets (drops the
 * duplicated header byte) and its reserved bits.
 */
export function repairAvcC(desc: Uint8Array, firstKeyframe?: Uint8Array): { description: Uint8Array; codec: string; problems: string[] } | null {
  const v = validateAvcC(desc);
  if (v.ok) return null;
  let sps: Uint8Array[] = [];
  let pps: Uint8Array[] = [];
  if (firstKeyframe) {
    for (const n of splitNalUnits(firstKeyframe, v.lengthSize)) {
      if (nalType(n[0]!) === 7) sps.push(dedupeHeader(n, 7));
      else if (nalType(n[0]!) === 8) pps.push(dedupeHeader(n, 8));
    }
  }
  if (!sps.length || !pps.length) {
    sps = v.sps.map((n) => dedupeHeader(n, 7)).filter((n) => nalType(n[0]!) === 7);
    pps = v.pps.map((n) => dedupeHeader(n, 8)).filter((n) => nalType(n[0]!) === 8);
  }
  if (!sps.length || !pps.length) throw new Error(`Can't repair the H.264 decoder config: ${v.problems.join('; ')}`);
  const description = buildAvcC(sps, pps, v.lengthSize);
  return { description, codec: avcCodecString(sps[0]!), problems: v.problems };
}

import { describe, expect, it } from 'vitest';
import { avcCodecString, buildAvcC, repairAvcC, splitNalUnits, validateAvcC } from '../src/avcc.js';

// A real High-profile SPS/PPS pair (1280x720, level 3.1) as Chrome/ffmpeg emit them.
const SPS = Uint8Array.from([0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40, 0x50, 0x05, 0xbb, 0x01, 0x10, 0x00, 0x00, 0x03, 0x00, 0x10, 0x00, 0x00, 0x03, 0x03, 0xc0, 0xf1, 0x83, 0x19, 0x60]);
const PPS = Uint8Array.from([0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0]);
const good = buildAvcC([SPS], [PPS]);

/** What Firefox (WMF/FFmpeg encoders, Bugzilla 2031056) produces: reserved bits clear, NAL header byte doubled. */
function firefoxStyle(): Uint8Array {
  const s = Uint8Array.from([SPS[0]!, ...SPS]);
  const p = Uint8Array.from([PPS[0]!, ...PPS]);
  return Uint8Array.from([1, SPS[1]!, SPS[2]!, SPS[3]!, 0x03, 0x01, s.length >> 8, s.length & 0xff, ...s, 1, p.length >> 8, p.length & 0xff, ...p]);
}

describe('avcC validation and repair (compat A1)', () => {
  it('a well-formed record validates and is left alone', () => {
    const v = validateAvcC(good);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.sps[0]).toEqual(SPS);
    expect(v.pps[0]).toEqual(PPS);
    expect(repairAvcC(good)).toBeNull();
    expect(good.slice(-4)).toEqual(Uint8Array.from([0xfd, 0xf8, 0xf8, 0])); // High-profile extension
  });
  it('flags the Firefox record (reserved bits, doubled headers)', () => {
    const v = validateAvcC(firefoxStyle());
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual(
      expect.arrayContaining(['reserved bits before lengthSizeMinusOne not set', 'reserved bits before numOfSequenceParameterSets not set', 'SPS 0: duplicated NAL header byte', 'PPS 0: duplicated NAL header byte']),
    );
  });
  it('repairs from the record itself', () => {
    const r = repairAvcC(firefoxStyle())!;
    expect(r.description).toEqual(good);
    expect(validateAvcC(r.description).ok).toBe(true);
    expect(r.codec).toBe('avc1.64001f');
  });
  it('prefers in-band SPS/PPS from the first keyframe (length-prefixed or Annex B)', () => {
    const lp = Uint8Array.from([0, 0, 0, SPS.length, ...SPS, 0, 0, 0, PPS.length, ...PPS, 0, 0, 0, 3, 0x65, 0x88, 0x84]);
    expect(repairAvcC(firefoxStyle(), lp)!.description).toEqual(good);
    const annexB = Uint8Array.from([0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS, 0, 0, 1, 0x65, 0x88]);
    expect(splitNalUnits(annexB).map((n) => n[0])).toEqual([0x67, 0x68, 0x65]);
    expect(repairAvcC(firefoxStyle(), annexB)!.description).toEqual(good);
  });
  it('rejects garbage clearly', () => {
    expect(validateAvcC(Uint8Array.from([1, 2])).ok).toBe(false);
    expect(() => repairAvcC(Uint8Array.from([1, 0x42, 0, 0x1e, 0xff, 0xe0, 0]))).toThrow(/Can't repair/);
    expect(avcCodecString(Uint8Array.from([0x67, 0x42, 0xc0, 0x1e]))).toBe('avc1.42c01e');
  });
});

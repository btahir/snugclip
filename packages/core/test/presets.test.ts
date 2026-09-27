// A7: presets data, parseSize, formatSize.
import { describe, expect, it } from 'vitest';
import { PRESETS, formatBitrate, formatDuration, formatSize, getPreset, outputName, parseSize, percentOfTarget, resolveTarget, targetLabel } from '../src/index.js';

const EXPECTED: Record<string, number> = {
  discord: 20_000_000,
  'discord-nitro-basic': 50_000_000,
  'discord-nitro': 500_000_000,
  whatsapp: 64_000_000,
  'whatsapp-document': 2_000_000_000,
  gmail: 18_000_000,
  outlook: 14_500_000,
  email: 14_500_000,
  slack: 1_000_000_000,
  telegram: 2_000_000_000,
  'telegram-premium': 4_000_000_000,
  imessage: 100_000_000,
  'size-8': 8_000_000,
  'size-10': 10_000_000,
  'size-25': 25_000_000,
  'size-50': 50_000_000,
  'size-100': 100_000_000,
};

describe('presets', () => {
  it('values exactly as PLAN §2', () => {
    expect(Object.fromEntries(PRESETS.map((p) => [p.id, p.bytes]))).toEqual(EXPECTED);
  });
  it('every preset has bytes, an https sourceUrl and checked 2026-09-27', () => {
    for (const p of PRESETS) {
      expect(p.sourceUrl, p.id).toMatch(/^https:\/\//);
      expect(p.checked).toBe('2026-09-27');
      expect(p.statedLimit.length).toBeGreaterThan(0);
    }
  });
  it('WhatsApp caps at 720p', () => {
    expect(getPreset('whatsapp')?.maxShortSide).toBe(720);
  });
  it('ids and aliases are unique; lookup is case-insensitive', () => {
    const keys = PRESETS.flatMap((p) => [p.id, ...p.aliases]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(getPreset('Discord-Free')?.id).toBe('discord');
    expect(getPreset('10mb')?.id).toBe('size-10');
  });
  it('resolveTarget', () => {
    expect(resolveTarget({ preset: 'discord' })).toEqual({ bytes: 20_000_000, presetId: 'discord', label: 'Discord' });
    expect(resolveTarget({ size: '9.5MB' })).toEqual({ bytes: 9_500_000, label: '9.5 MB' });
    expect(resolveTarget({ size: '10MiB', preset: 'discord' })).toEqual({ bytes: 10_485_760, label: '10 MiB' });
    expect(() => resolveTarget({ preset: 'myspace' })).toThrow(expect.objectContaining({ code: 'E_PRESET' }));
    expect(() => resolveTarget({})).toThrow(expect.objectContaining({ code: 'E_ARGS' }));
  });
});

describe('parseSize', () => {
  it.each([
    ['10MB', 10_000_000],
    ['10MiB', 10_485_760],
    ['10m', 10_000_000],
    ['1.5GB', 1_500_000_000],
    ['10', 10_000_000],
    ['500KB', 500_000],
    ['8000000', 8_000_000],
    [1234, 1234],
    ['4096MB', 4_096_000_000],
  ] as const)('%j → %d', (s, b) => expect(parseSize(s)).toBe(b));
  it.each(['0', '-1', 'abc', '4097MB', '5GB', '10XB', ''])('rejects %j', (s) => {
    expect(() => parseSize(s)).toThrow(expect.objectContaining({ code: 'E_ARGS' }));
  });
});

describe('formatSize (shared by UI and CLI)', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1 KB'],
    [169_363, '169 KB'],
    [999_999, '999 KB'],
    [1_000_000, '1 MB'],
    [9_999_999, '9.99 MB'],
    [9_870_000, '9.87 MB'],
    [10_000_000, '10 MB'],
    [14_500_000, '14.5 MB'],
    [18_000_000, '18 MB'],
    [19_987_654, '19.9 MB'],
    [25_115_487, '25.1 MB'],
    [512_000_000, '512 MB'],
    [2_000_000_000, '2 GB'],
    [1_250_000_000, '1.25 GB'],
  ])('%d → %s', (b, s) => expect(formatSize(b)).toBe(s));
  it('never shows a fit as larger than its target', () => {
    for (const t of [8e6, 10e6, 14.5e6, 18e6, 20e6, 25e6, 64e6]) for (const d of [1, 999, 4999, 9999]) expect(parseFloat(formatSize(t - d))).toBeLessThanOrEqual(t / 1e6);
  });
  it('ceil for minimums, nearest when asked', () => {
    expect(formatSize(3_401_000, { round: 'ceil' })).toBe('3.41 MB');
    expect(formatSize(9_996_000, { round: 'nearest' })).toBe('10 MB');
    expect(formatSize(999_600, { round: 'ceil' })).toBe('1 MB');
  });
  it('bitrate, duration, percent, labels, names', () => {
    expect(formatBitrate(96_000)).toBe('96 kbps');
    expect(formatBitrate(2_400_000)).toBe('2.4 Mbps');
    expect(formatDuration(8.44)).toBe('8.4 s');
    expect(formatDuration(305)).toBe('5:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(percentOfTarget(9_999_999, 10_000_000)).toBe(99.9);
    expect(targetLabel(14_500_000)).toBe('14.5 MB');
    expect(outputName('clip.mov', { bytes: 10_000_000, label: '10 MB' }, 'mp4')).toBe('clip-snug-10MB.mp4');
    expect(outputName('/a/IMG_0001.MOV', 14_500_000, 'mp4')).toBe('IMG_0001-snug-14.5MB.mp4');
    expect(outputName('C:\\x\\my.clip.webm', 10_485_760, 'webm')).toBe('my.clip-snug-10MiB.webm');
    expect(outputName('.hidden', 8e6, 'mp4')).toBe('.hidden-snug-8MB.mp4');
  });
});

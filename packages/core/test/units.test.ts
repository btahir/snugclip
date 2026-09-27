import { describe, expect, it } from 'vitest';
import { formatBitrate, formatBytes, formatDuration, formatTarget, outputName, parseSize, percentOfTarget } from '../src/index.js';

describe('parseSize', () => {
  it.each([
    ['10MB', 10_000_000],
    ['10 mb', 10_000_000],
    ['10', 10_000_000],
    ['9.5MB', 9_500_000],
    ['10MiB', 10_485_760],
    ['500KB', 500_000],
    ['500k', 500_000],
    ['1.5GB', 1_500_000_000],
    ['8000000', 8_000_000],
    ['.5MB', 500_000],
    [25, 25],
  ] as const)('%s → %d', (input, bytes) => {
    expect(parseSize(input)).toBe(bytes);
  });
  it.each(['', 'abc', '10XB', '-5MB', '0', 'MB'])('rejects %j', (input) => {
    expect(parseSize(input)).toBeNull();
  });
});

describe('formatBytes', () => {
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
    [24_990_000, '24.9 MB'],
    [25_115_487, '25.1 MB'],
    [512_000_000, '512 MB'],
    [1_250_000_000, '1.25 GB'],
  ])('%d → %s (floor)', (b, s) => {
    expect(formatBytes(b)).toBe(s);
  });
  it('never shows a fitting output as larger than its target', () => {
    for (const target of [8e6, 10e6, 25e6, 50e6]) {
      for (const b of [target - 1, target - 999, target - 5001]) {
        expect(Number.parseFloat(formatBytes(b))).toBeLessThanOrEqual(target / 1e6);
      }
    }
  });
  it('supports ceil and nearest', () => {
    expect(formatBytes(3_201_000, { round: 'ceil' })).toBe('3.21 MB');
    expect(formatBytes(9_996_000, { round: 'nearest' })).toBe('10 MB');
    expect(formatBytes(999_600, { round: 'ceil' })).toBe('1 MB');
  });
  it('handles junk', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('other formatters', () => {
  it('formatTarget', () => {
    expect(formatTarget(10_000_000)).toBe('10 MB');
    expect(formatTarget(10_485_760)).toBe('10 MiB');
    expect(formatTarget(9_500_000)).toBe('9.50 MB');
  });
  it('formatBitrate', () => {
    expect(formatBitrate(96_000)).toBe('96 kbps');
    expect(formatBitrate(2_400_000)).toBe('2.40 Mbps');
    expect(formatBitrate(12_345_678)).toBe('12.3 Mbps');
  });
  it('formatDuration', () => {
    expect(formatDuration(8.4)).toBe('8.4 s');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(305)).toBe('5:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('percentOfTarget floors', () => {
    expect(percentOfTarget(9_999_999, 10_000_000)).toBe(99.9);
    expect(percentOfTarget(9_700_000, 10_000_000)).toBe(97);
  });
  it('outputName', () => {
    expect(outputName('clip.mp4', 10_000_000, 'mp4')).toBe('clip-snug-10MB.mp4');
    expect(outputName('/a/b/IMG_0001.MOV', 8_000_000, 'mp4')).toBe('IMG_0001-snug-8MB.mp4');
    expect(outputName('C:\\x\\my.clip.webm', 9_500_000, 'webm')).toBe('my.clip-snug-9_50MB.webm');
    expect(outputName('noext', 10_485_760, 'mp4')).toBe('noext-snug-10MiB.mp4');
  });
});

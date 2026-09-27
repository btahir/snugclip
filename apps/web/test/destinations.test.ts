import { describe, expect, it } from 'vitest';
import { PRESETS, getPreset } from '@snugclip/core';
import { checkedLabel, defaultTarget, destinationForTarget, isValidCustomBytes, resolveDestinations, targetFromPreset } from '@/lib/destinations';
import { limitText, reductionText, spareText } from '@/lib/format';

describe('destinations', () => {
  const dests = resolveDestinations();
  it('shows chips in the spec order with presets from core', () => {
    expect(dests.map((d) => d.key)).toEqual(['discord', 'whatsapp', 'email', 'slack', 'telegram', 'imessage', 'size-8', 'size-10', 'size-25', 'size-50', 'size-100']);
    for (const d of dests) for (const t of d.tiers) expect(PRESETS).toContain(t.preset);
  });
  it('limits come from core presets (PLAN §2)', () => {
    const byKey = Object.fromEntries(dests.map((d) => [d.key, d.tiers.map((t) => t.preset.bytes)]));
    expect(byKey.discord).toEqual([20_000_000, 10_000_000, 50_000_000, 500_000_000]);
    expect(byKey.whatsapp![0]).toBe(64_000_000);
    expect(byKey.email).toEqual([14_500_000, 18_000_000, 14_500_000]);
  });
  it('maps a target back to its chip', () => {
    expect(destinationForTarget(targetFromPreset(getPreset('discord-nitro')!), dests)).toBe('discord');
    expect(destinationForTarget({ bytes: 25_000_000, label: '25 MB' }, dests)).toBe('size-25');
    expect(destinationForTarget({ bytes: 7_300_000, label: '7.3 MB' }, dests)).toBe('custom');
    expect(defaultTarget(dests).presetId).toBe('discord');
    // A plain size preset belongs to its size chip unless the person picked it from a platform's tiers.
    expect(destinationForTarget(targetFromPreset(getPreset('size-10')!), dests)).toBe('size-10');
    expect(destinationForTarget(targetFromPreset(getPreset('size-10')!), dests, 'discord')).toBe('discord');
  });
  it('custom range is 1 MB to 4096 MB', () => {
    expect(isValidCustomBytes(999_999)).toBe(false);
    expect(isValidCustomBytes(1_000_000)).toBe(true);
    expect(isValidCustomBytes(4_096_000_000)).toBe(true);
    expect(isValidCustomBytes(4_096_000_001)).toBe(false);
  });
  it('formats checked dates', () => {
    expect(checkedLabel('2026-09-27')).toBe('Sep 2026');
  });
});

describe('format wrappers', () => {
  it('limit labels', () => {
    expect(limitText(20_000_000)).toBe('20 MB');
    expect(limitText(14_500_000)).toBe('14.5 MB');
    expect(limitText(1_000_000_000)).toBe('1 GB');
  });
  it('spare room is floored and never negative', () => {
    expect(spareText(9_620_000, 10_000_000)).toBe('380 KB');
    expect(spareText(10_000_001, 10_000_000)).toBe('0 B');
  });
  it('reduction uses a real minus sign', () => {
    expect(reductionText(84_200_000, 9_620_000)).toBe('−89%');
  });
});

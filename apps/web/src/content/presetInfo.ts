import { formatSize, getPreset, targetLabel, type Preset } from '@snugclip/core';
import { checkedLabel } from '@/lib/destinations';

/** The preset or a loud build-time error (a renamed preset must never silently change copy). */
export function presetInfo(id: string): Preset {
  const p = getPreset(id);
  if (!p) throw new Error(`content: unknown preset "${id}"`);
  return p;
}

/** A preset's limit for copy: "20 MB", "14.5 MB", "1 GB", "2 GB". */
export function limit(id: string): string {
  const b = presetInfo(id).bytes;
  return b >= 1_000_000_000 ? formatSize(b, { round: 'nearest' }) : targetLabel(b);
}

/** The date presets were verified, for copy: "Sep 2026". */
export function checked(id = 'discord'): string {
  return checkedLabel(presetInfo(id).checked) ?? '';
}

/** ISO check date ("2026-09-27"). */
export function checkedIso(id = 'discord'): string {
  return presetInfo(id).checked;
}

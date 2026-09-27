// Destination chips for the target bar. Limits always come from @snugclip/core PRESETS
// (sourced and dated there); this file only decides chip order, glyphs and tier grouping.
// Preset ids are looked up through core's alias table, with fallbacks, so a renamed id
// (e.g. `discord-free` → `discord`) never breaks the UI.
import { getPreset, MAX_CUSTOM_BYTES, MB, type Preset, type Target } from '@snugclip/core';
import type { DestinationGlyph } from '@/components/glyphs.generated';

export interface TierDef {
  /** Candidate preset ids/aliases, first match wins. */
  ids: string[];
  /** Tier label inside the popover, e.g. "Nitro Basic". */
  label: string;
}

export interface DestinationDef {
  key: string;
  name: string;
  glyph: DestinationGlyph;
  /** The first tier is the default when the chip is picked. */
  tiers: TierDef[];
  kind: 'platform' | 'size';
}

export const DESTINATIONS: DestinationDef[] = [
  {
    key: 'discord',
    name: 'Discord',
    glyph: 'discord',
    kind: 'platform',
    tiers: [
      { ids: ['discord', 'discord-free'], label: 'Free' },
      { ids: ['size-10', '10mb', '10'], label: 'Older free' },
      { ids: ['discord-nitro-basic', 'nitro-basic'], label: 'Nitro Basic' },
      { ids: ['discord-nitro', 'nitro'], label: 'Nitro' },
    ],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    glyph: 'whatsapp',
    kind: 'platform',
    tiers: [
      { ids: ['whatsapp'], label: 'As video' },
      { ids: ['whatsapp-document'], label: 'As document' },
    ],
  },
  {
    key: 'email',
    name: 'Email',
    glyph: 'email',
    kind: 'platform',
    tiers: [
      { ids: ['email'], label: 'Any email' },
      { ids: ['gmail', 'email-gmail'], label: 'Gmail' },
      { ids: ['outlook', 'email-outlook'], label: 'Outlook' },
    ],
  },
  { key: 'slack', name: 'Slack', glyph: 'slack', kind: 'platform', tiers: [{ ids: ['slack'], label: 'Slack' }] },
  {
    key: 'telegram',
    name: 'Telegram',
    glyph: 'telegram',
    kind: 'platform',
    tiers: [
      { ids: ['telegram'], label: 'Free' },
      { ids: ['telegram-premium'], label: 'Premium' },
    ],
  },
  { key: 'imessage', name: 'iMessage', glyph: 'imessage', kind: 'platform', tiers: [{ ids: ['imessage'], label: 'iMessage' }] },
  ...[8, 10, 25, 50, 100].map(
    (n): DestinationDef => ({
      key: `size-${n}`,
      name: `${n} MB`,
      glyph: 'size',
      kind: 'size',
      tiers: [{ ids: [`size-${n}`, `${n}mb`, `${n}`], label: `${n} MB` }],
    }),
  ),
];

export interface ResolvedTier {
  label: string;
  preset: Preset;
}

export interface ResolvedDestination extends Omit<DestinationDef, 'tiers'> {
  tiers: ResolvedTier[];
}

function firstPreset(ids: string[]): Preset | null {
  for (const id of ids) {
    const p = getPreset(id);
    if (p) return p;
  }
  return null;
}

/** Destinations with their presets resolved from core; unknown tiers are dropped, duplicates merged. */
export function resolveDestinations(): ResolvedDestination[] {
  const out: ResolvedDestination[] = [];
  for (const d of DESTINATIONS) {
    const seen = new Set<string>();
    const tiers: ResolvedTier[] = [];
    for (const t of d.tiers) {
      const p = firstPreset(t.ids);
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      tiers.push({ label: t.label, preset: p });
    }
    if (tiers.length) out.push({ ...d, tiers });
  }
  return out;
}

export function targetFromPreset(p: Preset): Target {
  return { bytes: p.bytes, presetId: p.id, label: p.label };
}

/** Which destination chip (key) represents a target, or 'custom'. */
export function destinationForTarget(target: Target, dests: ResolvedDestination[], prefer?: string | null): string {
  if (target.presetId) {
    const p = prefer ? dests.find((d) => d.key === prefer) : undefined;
    if (p && p.tiers.some((t) => t.preset.id === target.presetId)) return p.key;
    // Plain size presets belong to their size chip even when a platform lists them as a tier.
    for (const d of dests) if (d.kind === 'size' && d.tiers[0]!.preset.id === target.presetId) return d.key;
    for (const d of dests) if (d.tiers.some((t) => t.preset.id === target.presetId)) return d.key;
  }
  for (const d of dests) if (d.kind === 'size' && d.tiers[0]!.preset.bytes === target.bytes) return d.key;
  return 'custom';
}

export const DEFAULT_DESTINATION = 'discord';

export function defaultTarget(dests: ResolvedDestination[] = resolveDestinations()): Target {
  const d = dests.find((x) => x.key === DEFAULT_DESTINATION) ?? dests[0]!;
  return targetFromPreset(d.tiers[0]!.preset);
}

export function isValidCustomBytes(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= MB && bytes <= MAX_CUSTOM_BYTES;
}

/** Human "checked" date for preset sources: "27 Sep 2026" (the exact day the source was read). */
export function checkedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

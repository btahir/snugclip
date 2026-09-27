// Keyword landing pages are typed data (PLAN §3). Limit numbers are never typed by hand: page
// files call `limit()`/`presetInfo()` so the copy always matches @snugclip/core PRESETS.
import type { DestinationGlyph } from '@/components/glyphs.generated';

export interface LimitRow {
  label: string;
  /** Pre-formatted size, e.g. from limit('discord'). */
  value: string;
  note?: string;
}

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  /** A computed table: what the planner picks for this target at 30 s / 1 / 2 / 5 min of 1080p30. */
  | { kind: 'planTable'; bytes: number; caption: string };

export interface Section {
  heading: string;
  blocks: Block[];
}

export interface KeywordPage {
  slug: string;
  /** Short label for footer/related links, e.g. "Compress for Discord". */
  navLabel: string;
  /** <title>, unique, ≤ 60 chars ideally. */
  title: string;
  /** Meta description, unique, 140–160 chars. */
  description: string;
  h1: string;
  lede: string;
  eyebrow: { glyph: DestinationGlyph; label: string; value: string };
  /** What the embedded tool preselects: a preset id/alias or a size string. */
  target: { preset?: string; size?: string };
  /** Label on the hero glass line, e.g. "20 MB". */
  glassLabel: string;
  limits: {
    heading: string;
    intro: string;
    rows: LimitRow[];
    /** Official sources: shown under the table with the checked date. */
    sources: { label: string; url: string }[];
    unitNote: string;
  };
  /** Page-specific prose (the bulk of the ≥400 unique words). */
  sections: Section[];
  howTo: { title: string; body: string }[];
  faq: { q: string; a: string[] }[];
  related: string[];
}

// Target presets as data. Each platform preset cites its official source and the date it
// was checked. Where a platform's unit is ambiguous (MB vs MiB) we use the smaller decimal
// value so the file fits under either reading. PLAN.md is the authority for these values.
import { MB } from './constants.js';
import type { Target } from './types.js';

export type PresetGroup = 'platform' | 'size';

export interface Preset {
  id: string;
  label: string;
  /** Short label for chips, e.g. "Discord". */
  short: string;
  group: PresetGroup;
  /** Target in bytes. */
  bytes: number;
  /** Official page stating the limit (platform presets only). */
  sourceUrl: string | null;
  /** ISO date the source was last checked. */
  checked: string | null;
  /** Plain-words explanation shown in details and on keyword pages. */
  note: string;
  /** Other ids / spellings accepted by the CLI, MCP and deep links. */
  aliases: string[];
}

const CHECKED = '2026-09-27';

export const PRESETS: readonly Preset[] = [
  {
    id: 'discord-free',
    label: 'Discord (free)',
    short: 'Discord',
    group: 'platform',
    bytes: 10 * MB,
    sourceUrl: 'https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ',
    checked: CHECKED,
    note: 'Discord caps uploads at 10 MB without Nitro. Snugclip uses 10,000,000 bytes so the file fits whether Discord counts MB or MiB.',
    aliases: ['discord', 'discord-10'],
  },
  {
    id: 'discord-nitro-basic',
    label: 'Discord Nitro Basic',
    short: 'Nitro Basic',
    group: 'platform',
    bytes: 50 * MB,
    sourceUrl: 'https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ',
    checked: CHECKED,
    note: 'Nitro Basic raises the upload limit to 50 MB.',
    aliases: ['nitro-basic', 'discord-basic'],
  },
  {
    id: 'discord-nitro',
    label: 'Discord Nitro',
    short: 'Nitro',
    group: 'platform',
    bytes: 500 * MB,
    sourceUrl: 'https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ',
    checked: CHECKED,
    note: 'Nitro raises the upload limit to 500 MB.',
    aliases: ['nitro'],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    short: 'WhatsApp',
    group: 'platform',
    bytes: 16 * MB,
    sourceUrl: 'https://faq.whatsapp.com/1098075221164617',
    checked: CHECKED,
    note: 'WhatsApp sends videos up to 16 MB as media (they play inline). Larger files only go as documents.',
    aliases: [],
  },
  {
    id: 'email',
    label: 'Email (Gmail)',
    short: 'Email',
    group: 'platform',
    bytes: 18 * MB,
    sourceUrl: 'https://support.google.com/mail/answer/6584',
    checked: CHECKED,
    note: 'Gmail allows 25 MB per message, but attachments grow about 33% when encoded for email, so the file itself must be about 18 MB or less.',
    aliases: ['gmail', 'email-gmail'],
  },
  {
    id: 'outlook',
    label: 'Email (Outlook)',
    short: 'Outlook',
    group: 'platform',
    bytes: 14 * MB,
    sourceUrl: 'https://support.microsoft.com/en-us/office/file-size-limits-for-outlook-com-7ab0bb86-9b87-4c4f-b3a7-a2e3b8b0e0e8',
    checked: CHECKED,
    note: 'Outlook.com allows 20 MB per message including encoding, which leaves about 14 MB for the file.',
    aliases: ['email-outlook'],
  },
  {
    id: 'slack',
    label: 'Slack',
    short: 'Slack',
    group: 'platform',
    bytes: 1000 * MB,
    sourceUrl: 'https://slack.com/help/articles/201330736-Add-files-to-Slack',
    checked: CHECKED,
    note: 'Slack accepts files up to 1 GB.',
    aliases: [],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    short: 'Telegram',
    group: 'platform',
    bytes: 2000 * MB,
    sourceUrl: 'https://telegram.org/faq#q-what-can-i-send-on-telegram',
    checked: CHECKED,
    note: 'Telegram accepts files up to 2 GB (4 GB with Premium).',
    aliases: [],
  },
  {
    id: 'imessage',
    label: 'iMessage',
    short: 'iMessage',
    group: 'platform',
    bytes: 100 * MB,
    sourceUrl: 'https://support.apple.com/guide/iphone/send-photos-videos-and-audio-iphb66cfeaad/ios',
    checked: CHECKED,
    note: 'iMessage sends videos up to about 100 MB; larger ones are sent as Mail Drop links or reduced by the phone.',
    aliases: ['messages', 'apple-messages'],
  },
  ...[8, 10, 25, 50, 100].map(
    (n): Preset => ({
      id: `${n}mb`,
      label: `${n} MB`,
      short: `${n} MB`,
      group: 'size',
      bytes: n * MB,
      sourceUrl: null,
      checked: null,
      note: `Exactly ${(n * MB).toLocaleString('en-US')} bytes or less.`,
      aliases: [`${n}`, `${n}-mb`],
    }),
  ),
];

const byKey = new Map<string, Preset>();
for (const p of PRESETS) {
  byKey.set(p.id, p);
  for (const a of p.aliases) byKey.set(a, p);
}

/** Looks up a preset by id or alias, case-insensitively. */
export function getPreset(idOrAlias: string): Preset | null {
  return byKey.get(idOrAlias.trim().toLowerCase()) ?? null;
}

/** Turns a preset into a Target. */
export function presetTarget(p: Preset): Target {
  return { bytes: p.bytes, presetId: p.id, label: p.label };
}

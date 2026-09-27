// Target presets as data (PLAN §2, verified 2026-09-27). `bytes` is the hard cap Snugclip
// guarantees. Where a platform's unit is unclear (MB vs MiB) we target decimal MB, which is
// always ≤ the MiB reading, so the file fits either way.
import { SnugclipError } from './errors.js';
import { MB, parseSize, targetLabel } from './size.js';
import type { Target } from './types.js';

export type PresetGroup = 'platform' | 'size';

export interface Preset {
  id: string;
  /** Chip label. */
  label: string;
  group: PresetGroup;
  bytes: number;
  /** Official page stating the limit (for size presets: the SI definition of MB). */
  sourceUrl: string;
  checked: string;
  /** The platform's own words, shortened. */
  statedLimit: string;
  /** How we read the platform's unit. */
  unit: string;
  note: string;
  /** Platforms that downscale anyway (WhatsApp → 720p). */
  maxShortSide?: number;
  /** Other spellings accepted by the CLI, MCP, job files and deep links. */
  aliases: string[];
}

const CHECKED = '2026-09-27';
const DISCORD_FAQ = 'https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ';
const SI_PREFIXES = 'https://www.bipm.org/en/measurement-units/si-prefixes';

/** Largest raw file that fits an email limit after base64 (+37%) and ~64 KB of headers/body. */
export function emailRawMax(limit: number): number {
  return Math.floor((limit - 64_000) / 1.37);
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'discord',
    label: 'Discord',
    group: 'platform',
    bytes: 20 * MB,
    sourceUrl: DISCORD_FAQ,
    checked: CHECKED,
    statedLimit: 'For non-Nitro subscribers, the maximum file upload is 20MB (up from 10MB as of August 2026).',
    unit: 'Stated "MB"; Discord\'s API reports MiB, so the real cap is probably 20 MiB. We target decimal.',
    note: 'Discord raised the free limit from 10 MB to 20 MB in August 2026 and is experimenting with limits per account, so some people still see 10 MB during the rollout.',
    aliases: ['discord-free'],
  },
  {
    id: 'discord-nitro-basic',
    label: 'Discord Nitro Basic',
    group: 'platform',
    bytes: 50 * MB,
    sourceUrl: DISCORD_FAQ,
    checked: CHECKED,
    statedLimit: 'Nitro Basic offers 50MB. Server Boost level 2 also gives 50 MB.',
    unit: 'as Discord',
    note: 'Nitro Basic (and servers at Boost level 2) allow 50 MB uploads.',
    aliases: ['nitro-basic'],
  },
  {
    id: 'discord-nitro',
    label: 'Discord Nitro',
    group: 'platform',
    bytes: 500 * MB,
    sourceUrl: DISCORD_FAQ,
    checked: CHECKED,
    statedLimit: 'Nitro offers up to 500MB. Boost level 3 gives 100 MB.',
    unit: 'as Discord',
    note: 'Nitro allows 500 MB uploads.',
    aliases: ['nitro'],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    group: 'platform',
    bytes: 64 * MB,
    sourceUrl: 'https://faq.whatsapp.com/453914586839706/?locale=en_US&cms_platform=android',
    checked: CHECKED,
    statedLimit:
      'For users with a faster internet connection, the default video size limit is 100MB and 720p resolution. For users with a slower internet connection, the default video size limit is 64MB and 480p resolution.',
    unit: '"MB", unclear; decimal is safe.',
    note: 'WhatsApp sends videos up to 100 MB at 720p on fast connections and 64 MB on slow ones. Snugclip uses the safer 64 MB and caps at 720p, since WhatsApp downsizes to 720p anyway. The old "16 MB" limit is out of date.',
    maxShortSide: 720,
    aliases: ['whatsapp-video'],
  },
  {
    id: 'whatsapp-document',
    label: 'WhatsApp (as document)',
    group: 'platform',
    bytes: 2000 * MB,
    sourceUrl: 'https://faq.whatsapp.com/453914586839706/?locale=en_US&cms_platform=android',
    checked: CHECKED,
    statedLimit: 'For documents, the maximum file size allowed is 2 GB.',
    unit: '"GB", unclear; decimal is safe.',
    note: 'Sent as a document, a video skips WhatsApp\'s own recompression and can be up to 2 GB.',
    aliases: [],
  },
  {
    id: 'gmail',
    label: 'Gmail',
    group: 'platform',
    bytes: 18 * MB,
    sourceUrl: 'https://support.google.com/mail/answer/6584',
    checked: CHECKED,
    statedLimit: 'For personal Gmail accounts, the limit is 25 MB (measured after encoding, which adds about 37%).',
    unit: '"MB" of the encoded message',
    note: 'Gmail\'s 25 MB counts the encoded message. Attachments grow about 37% when encoded, so the video itself must be about 18 MB or less: (25,000,000 − 64,000) ÷ 1.37 ≈ 18.2 MB, rounded down.',
    aliases: ['email-gmail'],
  },
  {
    id: 'outlook',
    label: 'Outlook',
    group: 'platform',
    bytes: 14_500_000,
    sourceUrl: 'https://support.microsoft.com/en-us/outlook/reduce-attachment-size-to-send-large-files-with-outlook',
    checked: CHECKED,
    statedLimit: 'The email size limit is 20 megabytes (MB), including both the attachment and the email.',
    unit: 'Microsoft pages conflict (20/25/34 MB); we use 20 MB as the encoded size.',
    note: 'Outlook\'s 20 MB includes the email and encoding (+33–37%), which leaves about 14.5 MB for the video: (20,000,000 − 64,000) ÷ 1.37 ≈ 14.55 MB, rounded down.',
    aliases: ['email-outlook'],
  },
  {
    id: 'email',
    label: 'Email (any)',
    group: 'platform',
    bytes: 14_500_000,
    sourceUrl: 'https://support.microsoft.com/en-us/outlook/reduce-attachment-size-to-send-large-files-with-outlook',
    checked: CHECKED,
    statedLimit: 'Lowest common documented consumer limit (Outlook, 20 MB encoded).',
    unit: 'as Outlook',
    note: 'Fits the strictest common email service (Outlook), so it also fits Gmail.',
    aliases: ['mail'],
  },
  {
    id: 'slack',
    label: 'Slack',
    group: 'platform',
    bytes: 1000 * MB,
    sourceUrl: 'https://slack.com/help/articles/201330736-Add-files-to-Slack',
    checked: CHECKED,
    statedLimit: 'You can add files up to 1GB in size.',
    unit: 'unclear; decimal is safe',
    note: 'Slack accepts files up to 1 GB.',
    aliases: [],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    group: 'platform',
    bytes: 2000 * MB,
    sourceUrl: 'https://telegram.org/faq',
    checked: CHECKED,
    statedLimit: 'Files of up to 2 GB each.',
    unit: 'MTProto uploads 2000 × 1 MiB parts; decimal is safe',
    note: 'Telegram accepts files up to 2 GB (4 GB with Premium).',
    aliases: [],
  },
  {
    id: 'telegram-premium',
    label: 'Telegram Premium',
    group: 'platform',
    bytes: 4000 * MB,
    sourceUrl: 'https://telegram.org/blog/700-million-and-premium',
    checked: CHECKED,
    statedLimit: '4 GB files.',
    unit: 'as Telegram',
    note: 'Telegram Premium accepts files up to 4 GB.',
    aliases: [],
  },
  {
    id: 'imessage',
    label: 'iMessage',
    group: 'platform',
    bytes: 100 * MB,
    sourceUrl: 'https://discussions.apple.com/thread/252822623',
    checked: CHECKED,
    statedLimit: 'Not officially documented; community reports consistently say 100 MB.',
    unit: 'unknown',
    note: 'Apple doesn\'t document an iMessage limit. People consistently report about 100 MB; larger videos go as iCloud links or get recompressed.',
    aliases: ['messages'],
  },
  ...[8, 10, 25, 50, 100].map(
    (n): Preset => ({
      id: `size-${n}`,
      label: `${n} MB`,
      group: 'size',
      bytes: n * MB,
      sourceUrl: SI_PREFIXES,
      checked: CHECKED,
      statedLimit: `${n} MB = ${(n * MB).toLocaleString('en-US')} bytes (SI mega = 10^6).`,
      unit: 'decimal',
      note: `At most ${(n * MB).toLocaleString('en-US')} bytes.`,
      aliases: [`${n}mb`, `${n}`],
    }),
  ),
];

const byKey = new Map<string, Preset>();
for (const p of PRESETS) {
  byKey.set(p.id, p);
  for (const a of p.aliases) byKey.set(a, p);
}

/** Looks up a preset by id or alias, case-insensitively. */
export function getPreset(idOrAlias: string): Preset | undefined {
  return byKey.get(idOrAlias.trim().toLowerCase());
}

/** Resolves `{preset}` or `{size}` (size wins if both) to a Target. Throws E_PRESET / E_ARGS. */
export function resolveTarget(t: { preset?: string; size?: string | number; bytes?: number }): Target {
  if (t.bytes !== undefined) return { bytes: parseSize(t.bytes), label: targetLabel(parseSize(t.bytes)) };
  if (t.size !== undefined && t.size !== '') {
    const bytes = parseSize(t.size);
    if (bytes < 10_000) throw new SnugclipError('E_ARGS', `Target ${bytes} bytes is too small; the minimum is 10 KB.`);
    return { bytes, label: targetLabel(bytes) };
  }
  if (t.preset) {
    const p = getPreset(t.preset);
    if (!p) throw new SnugclipError('E_PRESET', `Unknown preset "${t.preset}".`, { hint: 'Run `snugclip presets` to list them.' });
    return { bytes: p.bytes, presetId: p.id, label: p.label };
  }
  throw new SnugclipError('E_ARGS', 'Give a target: a size (e.g. 10MB) or a preset (e.g. discord).');
}

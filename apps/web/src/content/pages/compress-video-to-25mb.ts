import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-to-25mb',
  navLabel: 'To 25 MB',
  title: 'Compress Video to 25MB Free in Your Browser | Snugclip',
  description: `Compress a video to 25 MB in your browser. Snugclip never goes over, and explains why a 25 MB file still won't attach to Gmail and which size will attach.`,
  h1: 'Compress video to 25 MB',
  lede: `25 MB is a common upload cap, from web forms to Discord's old free limit. Snugclip fits your clip under it and keeps the video on your device.`,
  eyebrow: { glyph: 'size', label: 'Exact size', value: limit('size-25') },
  target: { preset: 'size-25' },
  glassLabel: limit('size-25'),
  limits: {
    heading: 'Where 25 MB shows up',
    intro: `Discord's free limit was ${limit('size-25')} in 2023 and 2024, and many guides still use that number. Gmail also says ${limit('size-25')}, which leads to a common mistake: a ${limit('size-25')} video won't actually attach to a Gmail message. Lots of web upload forms use the same round number too. Checked ${checked()}.`,
    rows: [
      { label: 'This target', value: limit('size-25'), note: '25,000,000 bytes' },
      { label: 'Discord free, 2023 to 2024', value: limit('size-25') },
      { label: 'Discord free today', value: limit('discord') },
      { label: 'Gmail message, after encoding', value: limit('size-25') },
      { label: 'Largest video you can attach in Gmail', value: limit('gmail') },
    ],
    sources: [
      { label: 'BIPM: SI prefixes (mega means one million)', url: presetInfo('size-25').sourceUrl },
      { label: 'Gmail Help: Attachment size limits', url: presetInfo('gmail').sourceUrl },
      { label: 'Google Workspace: Gmail receiving limits (37% encoding)', url: 'https://knowledge.workspace.google.com/admin/gmail/gmail-receiving-limits-in-google-workspace' },
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
    ],
    unitNote: `25 MB here is 25,000,000 bytes. If a site means 25 MiB, it allows 26,214,400 bytes. Snugclip always aims for the smaller decimal size, so the file is safe under either.`,
  },
  sections: [
    {
      heading: 'Why a 25 MB video bounces from Gmail',
      blocks: [
        {
          kind: 'p',
          text: `Gmail's ${limit('size-25')} limit counts the message after encoding. Email turns attachments into text with base64, and Google says that adds about 37%. A 25 MB video becomes about 34 MB inside the email, far over the line, and Gmail offers to send a Google Drive link instead of attaching it.`,
        },
        {
          kind: 'p',
          text: `To attach the video itself, it has to be about ${limit('gmail')} or less. Take 25,000,000 bytes, subtract about 64,000 for the message text and headers, and divide by 1.37. That comes to roughly 18.2 million bytes, which Snugclip rounds down. The Gmail chip uses that number. Use this page for uploads, and the email page for anything you plan to attach.`,
        },
      ],
    },
    {
      heading: 'The Discord limit that stuck around',
      blocks: [
        {
          kind: 'p',
          text: `In 2023 and 2024, ${limit('size-25')} was Discord's free upload limit. It dropped to ${limit('size-10')} in 2025, then rose to ${limit('discord')} in August 2026. Older bots, guides and habits still assume 25 MB, so if a Discord upload fails, check which limit your account is on before blaming the file. The Discord page lists every tier.`,
        },
      ],
    },
    {
      heading: 'What 25 MB is enough for',
      blocks: [
        {
          kind: 'p',
          text: '25 MB is 200 million bits, about 3.3 megabits per second across a one-minute clip. That leaves room for a sharp picture and good sound on short clips, and a fair picture on longer ones. The table is worked out by the same planner the tool uses.',
        },
        { kind: 'planTable', bytes: 25 * 1_000_000, caption: 'Planner output at 25 MB for a 1080p, 30 fps clip of each length' },
        {
          kind: 'p',
          text: 'If your file is already under 25 MB, Snugclip passes it through untouched by default, byte for byte. There is no point re-encoding a file that fits. If you want a smaller copy anyway, you can choose to re-encode it.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Pick 25 MB', body: 'On this page the tool opens at 25 MB. If the video is going into a Gmail message, tap the Email chip instead.' },
    { title: 'Drop the video in', body: `Add one clip or a whole batch. Snugclip reads each file's length, size and resolution before it plans anything.` },
    { title: 'Compress', body: 'The encode runs in your browser on your own hardware. Files that are already under 25 MB come back unchanged.' },
    { title: 'Save or share', body: 'Download the result, or on a phone tap Share to send it straight to another app.' },
  ],
  faq: [
    {
      q: `Why won't my 25 MB video attach to Gmail?`,
      a: [
        `Gmail's limit is for the encoded message, and encoding makes attachments about 37% bigger. A video needs to be about ${limit('gmail')} or less to attach. Snugclip's Gmail chip targets exactly that.`,
      ],
    },
    {
      q: `Wasn't Discord's limit 25 MB?`,
      a: [
        `It was, in 2023 and 2024. Since then it has been ${limit('size-10')} and, from August 2026, ${limit('discord')} for free accounts.`,
      ],
    },
    {
      q: 'What if my file is already under 25 MB?',
      a: [
        'Snugclip hands it back exactly as it was, with no re-encoding and no quality loss. You can still re-encode it if you want it smaller.',
      ],
    },
    {
      q: 'Will my video stay at 1080p?',
      a: [
        'For shorter clips, usually yes. Longer ones step down so the picture stays clean; the table above shows where. Snugclip never makes a video bigger than its source resolution.',
      ],
    },
    {
      q: 'Is my video sent anywhere?',
      a: ['No. Snugclip runs in your browser, and the video never leaves your device.'],
    },
  ],
  related: ['compress-video-for-email', 'compress-video-for-discord', 'compress-video-to-20mb', 'compress-video-to-50mb', 'reduce-video-size'],
};

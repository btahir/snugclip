import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-to-8mb',
  navLabel: 'To 8 MB',
  title: 'Compress Video to 8MB Online, Free | Snugclip',
  description: `Compress a video to 8 MB for older Discord servers, forums and bots. Snugclip runs in your browser, never goes over 8 MB, and keeps the clip on your device.`,
  h1: 'Compress video to 8 MB',
  lede: `Some places still cap uploads at 8 MB. Snugclip shrinks your clip to fit under it, right in your browser, and never hands you a file that is even one byte over.`,
  eyebrow: { glyph: 'size', label: 'Exact size', value: limit('size-8') },
  target: { preset: 'size-8' },
  glassLabel: limit('size-8'),
  limits: {
    heading: 'Where 8 MB still applies',
    intro: `Eight megabytes was Discord's free upload limit for years, until 2023. Discord has moved on since (free accounts get ${limit('discord')} now), but the number stuck. Plenty of forums, older chat bots and game communities still set 8 MB as their cap, and lots of people simply remember it as "the Discord size". Checked ${checked()}.`,
    rows: [
      { label: 'This target', value: limit('size-8'), note: '8,000,000 bytes' },
      { label: 'Discord free, before 2023', value: limit('size-8') },
      { label: 'Discord free, 2025 to Aug 2026', value: limit('size-10') },
      { label: 'Discord free today', value: limit('discord') },
    ],
    sources: [
      { label: 'BIPM: SI prefixes (mega means one million)', url: presetInfo('size-8').sourceUrl },
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
    ],
    unitNote: `Here 1 MB means 1,000,000 bytes, so 8 MB is 8,000,000 bytes. Some sites mean 8 MiB (8,388,608 bytes), which is a little bigger. Snugclip aims for the decimal number, so the file fits whichever one a site uses.`,
  },
  sections: [
    {
      heading: 'How much video fits in 8 MB',
      blocks: [
        {
          kind: 'p',
          text: '8 MB is 64 million bits. Spread over a one-minute clip, that is a little over 1 megabit per second for picture and sound together. It is enough for a clean short clip, but nowhere near enough for a long full HD recording.',
        },
        {
          kind: 'p',
          text: `The table comes straight from Snugclip's planner, the code that runs when you press go. It assumes a 1080p source at 30 frames per second with stereo sound, and shows what the planner would pick at each length.`,
        },
        { kind: 'planTable', bytes: 8 * 1_000_000, caption: 'What 8 MB buys for a 1080p, 30 fps clip at different lengths' },
        {
          kind: 'p',
          text: 'As the clip gets longer, the planner lowers the resolution, because each pixel would otherwise get too few bits for a sharp picture. That is expected. Nobody can squeeze five minutes of full HD into 8 MB and keep it crisp.',
        },
      ],
    },
    {
      heading: 'Making the most of a tight budget',
      blocks: [
        {
          kind: 'list',
          items: [
            'Trim first. Every second you cut hands its bits to the seconds you keep. Most clips shared in chat only need the ten seconds that matter.',
            'Mute it if the sound adds nothing. Audio takes a fixed slice of the budget, and muting gives all of it to the picture.',
            'Let 60 fps drop to 30. Smooth motion costs a lot of bits, so the planner does this before touching resolution.',
            'Let the resolution fall. A clean 720p clip looks better than a blocky 1080p one.',
            'Keep Compatible on unless you know the viewer can play AV1 or HEVC.',
          ],
        },
        {
          kind: 'p',
          text: 'Snugclip handles the frame rate and resolution for you. Trimming and muting are your call, since only you know which part of the clip counts.',
        },
      ],
    },
    {
      heading: 'Why some tools miss 8 MB and this one does not',
      blocks: [
        {
          kind: 'p',
          text: `Many compressors guess a bitrate from the length and hope. Encoders rarely land exactly on the bitrate you ask for, so the file comes out at 8.3 MB and the upload bounces. Snugclip first runs short test encodes to see how your clip behaves, then encodes, measures the result and corrects. Any attempt that comes out too big is thrown away, so you only ever get a file at 8 MB or under.`,
        },
      ],
    },
  ],
  howTo: [
    { title: 'Choose 8 MB', body: 'Tap the 8 MB chip. The limit line on the meter moves to exactly 8,000,000 bytes.' },
    { title: 'Add the clip, then trim', body: 'Drop the video in and drag the timeline handles to keep only the part you need. A shorter clip comes out sharper at this size.' },
    { title: 'Press go', body: 'The planner chooses a resolution and frame rate that suit the budget, and the encode runs on your device. There is no upload and no queue.' },
    { title: 'Preview before saving', body: 'Scrub through the before and after view. If it looks too soft, trim a bit more or mute the sound, and run it again.' },
  ],
  faq: [
    {
      q: 'Is Discord still limited to 8 MB?',
      a: [
        `No. 8 MB was the free limit until 2023. It then went to ${limit('size-25')}, dropped to ${limit('size-10')} in 2025, and rose to ${limit('discord')} in August 2026. If you are fitting a clip for Discord today, the Discord page has the current tiers.`,
      ],
    },
    {
      q: 'Why was my "8 MB" file refused?',
      a: [
        'Often the file was a little over, like 8.2 MB, and the tool that made it rounded the number down. Snugclip checks the real byte count, so its files are at most 8,000,000 bytes.',
        'If a file that size is still refused, the site probably counts its limit differently or has a lower one than it shows. Type a smaller custom size, such as 7 MB, and try again.',
      ],
    },
    {
      q: 'How long a video can I fit in 8 MB?',
      a: [
        'It depends on how much moves in the clip. The table above shows what the planner picks for lengths from 30 seconds to 5 minutes. For a crisp result, aim for well under a minute.',
      ],
    },
    {
      q: 'Does muting really make a difference?',
      a: [
        'At this size, yes. Snugclip picks an audio bitrate between 24 and 128 kbps from the budget. Muting frees all of that for the picture, which matters most when every bit counts.',
      ],
    },
    {
      q: 'Is it free, and is there a watermark?',
      a: [
        'It is free and open source under the MIT licence, with no watermark and no account. The video never leaves your device while it is compressed.',
      ],
    },
  ],
  related: ['compress-video-for-discord', 'compress-video-to-10mb', 'compress-video-to-20mb', 'reduce-video-size', 'compress-video-without-uploading'],
};

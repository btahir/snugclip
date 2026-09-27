import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'reduce-video-size',
  navLabel: 'Reduce video size',
  title: 'Reduce Video Size to Any Exact Limit | Snugclip',
  description: `Reduce a video's file size to an exact limit. Learn how bitrate, length, resolution and frame rate decide the size, then let Snugclip do it in your browser.`,
  h1: 'Reduce video size',
  lede: `A video's size comes down to two things: how many bits it uses each second and how long it runs. Snugclip tunes the first so the file fits any limit you pick.`,
  eyebrow: { glyph: 'custom', label: 'Any size', value: `${limit('size-25')} to start` },
  target: { preset: 'size-25' },
  glassLabel: limit('size-25'),
  limits: {
    heading: 'Limits for other apps',
    intro: `Some apps accept files so large that most clips fit without any work. Slack takes files up to ${limit('slack')}, and Telegram up to ${limit('telegram')}, or ${limit('telegram-premium')} with Premium. Apple doesn't document a limit for iMessage at all. People consistently report about ${limit('imessage')}, and bigger videos get sent as iCloud links or recompressed. Checked ${checked()}.`,
    rows: [
      { label: 'Slack', value: limit('slack') },
      { label: 'Telegram', value: limit('telegram') },
      { label: 'Telegram Premium', value: limit('telegram-premium') },
      { label: 'iMessage', value: limit('imessage'), note: 'Not officially documented by Apple' },
    ],
    sources: [
      { label: 'Slack Help: Add files to Slack', url: presetInfo('slack').sourceUrl },
      { label: 'Telegram FAQ', url: presetInfo('telegram').sourceUrl },
      { label: 'Telegram blog: Premium (4 GB files)', url: presetInfo('telegram-premium').sourceUrl },
      { label: 'Apple Community thread (user reports, not official)', url: presetInfo('imessage').sourceUrl },
    ],
    unitNote: `Snugclip counts in decimal units: 1 MB is 1,000,000 bytes and 1 GB is 1,000,000,000 bytes. Where an app doesn't say whether it means MB or MiB, the decimal figure is the smaller one, so a file aimed at it fits either way.`,
  },
  sections: [
    {
      heading: 'The one formula behind every video size',
      blocks: [
        {
          kind: 'p',
          text: 'File size is bitrate times duration. Bitrate is how many bits the video uses each second. A clip at 2 megabits per second that runs for 60 seconds uses 120 megabits, which is 15 MB. Add sound at 128 kilobits per second and that is another 0.96 MB.',
        },
        {
          kind: 'p',
          text: 'The length is usually fixed, because you want the whole clip. So to hit a size you pick a bitrate: the budget divided by the length. Everything else is about spending that bitrate well.',
        },
      ],
    },
    {
      heading: 'The levers that decide how it looks',
      blocks: [
        {
          kind: 'list',
          items: [
            'Resolution. Fewer pixels means more bits for each one. A 720p frame has less than half the pixels of a 1080p frame, so it looks cleaner at the same bitrate.',
            'Frame rate. Sixty frames a second needs far more data than thirty. Dropping to 30 is often the saving you notice least.',
            'Codec. Newer codecs like HEVC and AV1 need roughly half the bits of H.264 for a similar picture, but not every device can play them.',
            'Audio. Sound takes a steady slice of the budget. A lower audio bitrate, or muting, leaves more for the picture.',
            'Length. Trimming is the strongest lever of all. Half the length means twice the bitrate for the same size.',
          ],
        },
        {
          kind: 'p',
          text: `Snugclip's planner works through these in order. It drops 60 fps to 30 first, then steps the resolution down one rung at a time (2160, 1440, 1080, 720, 540, 480, 360, 240) until each pixel gets enough bits. It never upscales.`,
        },
      ],
    },
    {
      heading: 'Why typing in a bitrate is not enough',
      blocks: [
        {
          kind: 'p',
          text: `You could type a bitrate into a video editor, but encoders rarely hit the number exactly. Busy footage like confetti or rippling water overshoots, and a still slide undershoots. Snugclip runs two or three short test encodes to see how your clip behaves on your machine, encodes it, then checks the result. If it comes out over, it tries again at a lower bitrate. Snugclip never gives you a file over the limit.`,
        },
      ],
    },
    {
      heading: 'Choosing a size',
      blocks: [
        {
          kind: 'p',
          text: 'If the video is going somewhere specific, use its chip: Discord, WhatsApp, Email, Slack, Telegram or iMessage. For anything else, type your own size into Custom, from 1 MB up to 4096 MB. Snugclip remembers the last target you used, so next time it is already set.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Set a target', body: 'Tap a destination chip or type a custom size. The meter shows the limit as a line the file has to settle under.' },
    { title: 'Drop the file in', body: 'Add one video or a dozen. Each one is planned on its own, so a short clip and a long one both come out right.' },
    { title: 'Change options if you want', body: 'Trim, mute, cap the resolution, or keep the original frame rate. You can skip all of this; the defaults are chosen to fit.' },
    { title: 'Compress and compare', body: 'Watch the size settle under the line, then compare the before and after and read the quality badge.' },
  ],
  faq: [
    {
      q: 'What is the quickest way to make a video smaller?',
      a: [
        'Trim it. Cutting the parts nobody needs shrinks the file without touching the quality of what is left. After that, letting the resolution fall does the most.',
      ],
    },
    {
      q: 'Does reducing the size always lose quality?',
      a: [
        'Re-encoding always loses some detail, but how much depends on the budget. Snugclip shows a plain badge such as "Looks great" or "Softer, still clear", with SSIM and PSNR scores under details.',
        'If the file is already under your target, Snugclip passes it through untouched, so nothing is lost at all.',
      ],
    },
    {
      q: 'What is the iMessage size limit?',
      a: [
        `Apple doesn't publish one. People consistently report about ${limit('imessage')}, and larger videos are sent as iCloud links or recompressed. The iMessage chip uses that reported figure.`,
      ],
    },
    {
      q: 'Do I need to compress videos for Slack or Telegram?',
      a: [
        `Usually not. Slack allows ${limit('slack')} and Telegram ${limit('telegram')}, so only very long, high-resolution recordings need shrinking. A smaller file still uploads faster, though.`,
      ],
    },
    {
      q: 'Does the video leave my computer?',
      a: ['No. Everything runs in your browser, and the video never leaves your device.'],
    },
  ],
  related: ['compress-mp4', 'compress-mov', 'compress-video-to-25mb', 'compress-video-for-email', 'compress-video-without-uploading'],
};

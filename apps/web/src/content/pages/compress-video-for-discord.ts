import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-for-discord',
  navLabel: 'For Discord',
  title: 'Compress Video for Discord Under the Limit | Snugclip',
  description: `Compress a video for Discord in your browser. Snugclip fits it under the ${limit('discord')} free limit or your Nitro tier, never goes over, and never uploads it.`,
  h1: 'Compress video for Discord',
  lede: `Pick your Discord tier, drop in a clip, and get a file that fits. Snugclip never gives you a file over the limit, and the video never leaves your device.`,
  eyebrow: { glyph: 'discord', label: 'Discord', value: `${limit('discord')} free` },
  target: { preset: 'discord' },
  glassLabel: limit('discord'),
  limits: {
    heading: 'Discord upload limits by tier',
    intro: `Discord's free upload limit went up from ${limit('size-10')} to ${limit('discord')} in August 2026. Discord says it is still testing different limits on different accounts, so for a while some people will keep seeing the old ${limit('size-10')} cap. If an upload fails at ${limit('discord')}, pick the ${limit('size-10')} chip and try again. Paid plans raise the limit for you everywhere, while server boosts raise it for everyone posting in that one server. Checked ${checked()}.`,
    rows: [
      { label: 'Free account', value: limit('discord'), note: `Some accounts still see ${limit('size-10')} during the rollout` },
      { label: 'Nitro Basic', value: limit('discord-nitro-basic') },
      { label: 'Nitro', value: limit('discord-nitro') },
      { label: 'Server Boost level 2', value: limit('discord-nitro-basic'), note: 'For everyone posting in that server' },
      { label: 'Server Boost level 3', value: limit('size-100'), note: 'For everyone posting in that server' },
    ],
    sources: [
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
      { label: 'Discord: What are Nitro and Nitro Basic?', url: 'https://support.discord.com/hc/en-us/articles/115000435108-What-are-Nitro-Nitro-Basic' },
      { label: 'Discord: Server Boosting FAQ', url: 'https://support.discord.com/hc/en-us/articles/360028038352' },
    ],
    unitNote: `Discord writes "MB", but its API seems to count in MiB (1 MiB = 1,048,576 bytes), which would make the real cap a little larger. Snugclip targets decimal megabytes (1 MB = 1,000,000 bytes), so the file fits under either reading.`,
  },
  sections: [
    {
      heading: 'What changed in August 2026',
      blocks: [
        {
          kind: 'p',
          text: `Before August 2026, a free account could send ${limit('size-10')}. That was itself a drop from the ${limit('size-25')} limit of 2023 and 2024, and many old guides still quote ${limit('size-8')} from before that. Discord's help page now says ${limit('discord')} for people without Nitro.`,
        },
        {
          kind: 'p',
          text: `The change is reaching people unevenly. Discord says it is trying out several limits, so two friends on free accounts can see different numbers on the same day. You can't choose your own limit, but you can find it: if Discord says a file under ${limit('discord')} is too large, your account is still on the old cap. Snugclip keeps the ${limit('size-10')} chip one tap away for exactly that case.`,
        },
      ],
    },
    {
      heading: 'Which codecs Discord plays in the chat',
      blocks: [
        {
          kind: 'p',
          text: `Discord's FAQ lists H.264, HEVC and AV1 as video formats it can embed, so the clip plays right in the channel instead of showing up as a download. Whether it really plays also depends on the person watching. Some browsers and older phones can't decode HEVC or AV1, and then your friends see a file icon or a black box.`,
        },
        {
          kind: 'list',
          items: [
            'H.264 with AAC sound in an MP4: plays in the Discord app on desktop and phone, and in every major browser.',
            'HEVC: smaller files for the same picture, but some browsers refuse to play it.',
            'AV1: the smallest of the three, but it needs fairly new hardware or software to decode smoothly.',
          ],
        },
      ],
    },
    {
      heading: 'Why Compatible is the safe choice',
      blocks: [
        {
          kind: 'p',
          text: `Snugclip has two codec modes. Compatible makes H.264 video with AAC audio in an MP4, the format almost every device can play. Smaller uses AV1 where your browser can encode it, or HEVC otherwise, and packs a bit more detail into the same number of bytes.`,
        },
        {
          kind: 'p',
          text: `For a server full of people on different devices, pick Compatible. A slightly softer clip that plays for everyone beats a sharper one that half the channel can't open. Smaller makes sense when you know who is watching, like a DM to a friend with a new phone.`,
        },
      ],
    },
    {
      heading: 'How long a clip fits on a free account',
      blocks: [
        {
          kind: 'p',
          text: `The table below comes from Snugclip's planner, the same code that runs when you press go. It shows the resolution and frame rate it would choose for a 1080p, 30 fps clip at the free limit. Short clips keep full HD. Longer ones step down so the picture stays clean instead of turning blocky.`,
        },
        { kind: 'planTable', bytes: presetInfo('discord').bytes, caption: `What fits in Discord's free ${limit('discord')} for a 1080p, 30 fps clip, as planned by Snugclip` },
      ],
    },
  ],
  howTo: [
    {
      title: 'Pick your tier',
      body: `Tap the Discord chip for the free ${limit('discord')} limit, or Nitro Basic or Nitro if you pay for one. If uploads still fail at ${limit('discord')}, switch to the ${limit('size-10')} chip.`,
    },
    {
      title: 'Drop in your clip',
      body: 'Drag the video onto the page, paste it, or tap to choose it. If you only need part of it, drag the handles on the timeline to trim the start and end.',
    },
    {
      title: 'Let it fit',
      body: 'Snugclip measures the clip, picks a resolution and bitrate, and encodes it on your own computer or phone. It checks the finished size before handing it over.',
    },
    {
      title: 'Check it and post it',
      body: 'Compare the before and after, read the quality badge, then download the file and drag it into your Discord chat.',
    },
  ],
  faq: [
    {
      q: 'Does Discord compress videos itself?',
      a: [
        `No. Discord doesn't shrink a video to make it fit your limit. If the file is too big, the upload is refused and Discord tells you the file is too large.`,
        'That is why it helps to fit the file first. Snugclip does the shrinking on your device before you open Discord.',
      ],
    },
    {
      q: `Why does my account still stop at ${limit('size-10')}?`,
      a: [
        `Discord is moving free accounts to ${limit('discord')} in stages and testing different limits along the way. Until your account switches over, the old ${limit('size-10')} cap applies. There's no setting to change it. Use the ${limit('size-10')} chip in the meantime.`,
      ],
    },
    {
      q: 'What is the Discord upload limit with Nitro?',
      a: [
        `Nitro Basic allows ${limit('discord-nitro-basic')} and full Nitro allows ${limit('discord-nitro')}. Server boosts also raise the limit for every member of that server: ${limit('discord-nitro-basic')} at Boost level 2 and ${limit('size-100')} at level 3.`,
      ],
    },
    {
      q: 'Will my clip play in the chat or show as a download?',
      a: [
        'With the Compatible setting, the clip is H.264 and AAC in an MP4, which Discord embeds and nearly every device can play. With Smaller, some viewers on older devices or certain browsers may only get a download link.',
      ],
    },
    {
      q: 'Is my video uploaded to Snugclip?',
      a: [
        'No. Snugclip runs entirely in your browser, and the video never leaves your device. There is no Snugclip server that could receive it.',
      ],
    },
  ],
  related: ['compress-video-to-10mb', 'compress-video-to-20mb', 'compress-video-to-8mb', 'compress-video-to-50mb', 'compress-video-for-whatsapp'],
};

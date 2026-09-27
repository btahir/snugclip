import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-to-20mb',
  navLabel: 'To 20 MB',
  title: 'Compress Video to 20MB for Discord and Outlook | Snugclip',
  description: `Compress a video to 20 MB for Discord's new free limit. Snugclip never goes over, runs in your browser, and shows why Outlook's 20 MB leaves less for video.`,
  h1: 'Compress video to 20 MB',
  lede: `20 MB is Discord's new free upload limit. Snugclip fits your clip under it on your own device and never gives you a file over the line.`,
  eyebrow: { glyph: 'size', label: 'Exact size', value: '20 MB' },
  target: { size: '20MB' },
  glassLabel: '20 MB',
  limits: {
    heading: 'Where 20 MB comes up',
    intro: `In August 2026 Discord raised its free upload limit to ${limit('discord')}, up from ${limit('size-10')}, so a lot of people now need clips at exactly that size. Outlook uses 20 MB as well, but for a whole email, which is a different thing (more on that below). Checked ${checked()}.`,
    rows: [
      { label: 'This target', value: '20 MB', note: '20,000,000 bytes' },
      { label: 'Discord free', value: limit('discord') },
      { label: 'Discord free, accounts not yet switched', value: limit('size-10') },
      { label: 'Outlook email, whole message', value: '20 MB', note: 'Includes encoding and text' },
      { label: 'Largest video in that Outlook email', value: limit('outlook') },
    ],
    sources: [
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
      { label: 'Microsoft Support: Reduce attachment size in Outlook', url: presetInfo('outlook').sourceUrl },
      { label: 'Microsoft Learn: Exchange Online limits', url: 'https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits' },
      { label: 'BIPM: SI prefixes (mega means one million)', url: presetInfo('size-25').sourceUrl },
    ],
    unitNote: `Snugclip reads 20 MB as 20,000,000 bytes. Discord's API seems to count in MiB, where 20 MiB is 20,971,520 bytes. Aiming for the decimal number keeps the file under both readings.`,
  },
  sections: [
    {
      heading: `Discord's new free limit`,
      blocks: [
        {
          kind: 'p',
          text: `Discord's help page says free accounts can now upload ${limit('discord')}. It is arriving in stages, and Discord says it is testing limits per account, so not everyone has it yet. If a 20 MB file is refused, your account is still on the old ${limit('size-10')} cap.`,
        },
        {
          kind: 'p',
          text: 'The Discord page covers every tier and which codecs play in the chat. This page is for when you just want a file of 20 MB or less, for Discord or for any upload form with the same cap.',
        },
      ],
    },
    {
      heading: 'Why a 20 MB email is not a 20 MB file',
      blocks: [
        {
          kind: 'p',
          text: `Outlook's limit is 20 MB for the whole message: your text, your signature, the headers and the attachment together. On top of that, email can't carry raw video bytes. Attachments are turned into plain text with a scheme called base64, which makes every 3 bytes into 4 characters and adds line breaks. Microsoft says this grows a message by about 33%, and Google puts it at about 37%.`,
        },
        {
          kind: 'p',
          text: `So a 20 MB video attached to an Outlook email swells to roughly 27 MB on its way out, and it bounces. To fit, the video has to be about ${limit('outlook')} or smaller. Snugclip's Outlook chip already does this sum:`,
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Start from the limit: 20,000,000 bytes.',
            'Set aside about 64,000 bytes for the text, signature and headers.',
            'Divide what is left by 1.37 to allow for the encoding.',
            `That gives about 14.55 million bytes, which Snugclip rounds down to ${limit('outlook')}.`,
          ],
        },
      ],
    },
    {
      heading: 'What 20 MB holds',
      blocks: [
        {
          kind: 'p',
          text: '20 MB is 160 million bits. Across a minute that works out to about 2.7 megabits per second, a comfortable budget for a clean picture. The table shows where the planner lands for longer clips.',
        },
        { kind: 'planTable', bytes: 20 * 1_000_000, caption: 'The planner at 20 MB: resolution and frame rate for a 1080p, 30 fps clip by length' },
        {
          kind: 'p',
          text: 'Snugclip never upscales. A 720p source stays 720p even when there are bits to spare, and the extra room goes into fewer compression artefacts instead.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Start at 20 MB', body: 'This page opens the tool with 20 MB already set. Anywhere else, type any size you like into the Custom chip.' },
    { title: 'Add your video', body: 'Drop in one clip or several. Each one gets its own meter and its own plan.' },
    { title: 'Wait for the fit', body: 'Snugclip encodes in the browser, checks the size, and tries again at a lower bitrate if it has to. A file over 20 MB is never kept.' },
    { title: 'Send it the right way', body: 'For Discord, upload the file as it is. For Outlook, switch to the Outlook chip instead, because email encoding needs extra room.' },
  ],
  faq: [
    {
      q: `Is Discord's free limit really 20 MB now?`,
      a: [
        `Yes. Discord's File Attachments FAQ says the free limit is ${limit('discord')}, up from ${limit('size-10')} in August 2026. Some accounts are still on the old number while the change rolls out.`,
      ],
    },
    {
      q: 'Can I email a 20 MB video from Outlook?',
      a: [
        `No. Outlook's 20 MB covers the whole encoded message, so the video itself needs to be about ${limit('outlook')} or less. For anything bigger, share it as a OneDrive link.`,
      ],
    },
    {
      q: 'Why is there no 20 MB chip?',
      a: [
        `The Discord chip already targets ${limit('discord')}. This page uses a custom size of 20 MB so it keeps working for any upload with that cap, even if Discord changes its number again.`,
      ],
    },
    {
      q: 'Is 20 MB the same as 20 MiB?',
      a: ['No. 20 MiB is 20,971,520 bytes, about 5% more. Snugclip aims for 20,000,000 bytes, which fits under both.'],
    },
    {
      q: 'Does my video get sent to a server?',
      a: ['No. The compression runs in your browser tab, and the video never leaves your device.'],
    },
  ],
  related: ['compress-video-for-discord', 'compress-video-for-email', 'compress-video-to-10mb', 'compress-video-to-25mb'],
};

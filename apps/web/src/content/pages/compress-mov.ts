import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-mov',
  navLabel: 'Compress MOV',
  title: 'Compress MOV and iPhone Videos to MP4 | Snugclip',
  description: `Compress MOV files and iPhone videos to a small MP4 in your browser. Snugclip turns HEVC and HDR into H.264, keeps rotation right, and never uploads a thing.`,
  h1: 'Compress MOV and iPhone videos',
  lede: `iPhones save video as MOV files that are large and don't play everywhere. Snugclip turns them into small MP4s that fit your limit, right on your phone or computer.`,
  eyebrow: { glyph: 'size', label: 'iPhone MOV', value: limit('size-25') },
  target: { preset: 'size-25' },
  glassLabel: limit('size-25'),
  limits: {
    heading: 'Where iPhone videos usually go',
    intro: `A MOV file straight off an iPhone is often too big for where you want to send it. These are common places and their limits. Apple doesn't publish an iMessage limit, so that figure is what people consistently report rather than an official number. Checked ${checked()}.`,
    rows: [
      { label: 'iMessage', value: limit('imessage'), note: 'Not officially documented' },
      { label: 'WhatsApp video', value: limit('whatsapp') },
      { label: 'Discord, free account', value: limit('discord') },
      { label: 'Email (Gmail and Outlook)', value: limit('email') },
      { label: 'Common upload form', value: limit('size-25') },
    ],
    sources: [
      { label: 'Apple Community thread (user reports, not official)', url: presetInfo('imessage').sourceUrl },
      { label: 'WhatsApp Help Center', url: presetInfo('whatsapp').sourceUrl },
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
      { label: 'Microsoft Support: Reduce attachment size in Outlook', url: presetInfo('email').sourceUrl },
    ],
    unitNote: `Your iPhone and Mac show file sizes in decimal units, the same as Snugclip: 1 MB = 1,000,000 bytes. Some sites count in MiB (1,048,576 bytes), which is larger, so a file sized in decimal fits there too.`,
  },
  sections: [
    {
      heading: 'Why iPhone videos are so big',
      blocks: [
        {
          kind: 'p',
          text: 'Recent iPhones record in HEVC by default, often at 4K, sometimes at 60 frames per second, and many in HDR. That makes lovely footage and very large files. A single minute of 4K can run to hundreds of megabytes.',
        },
        {
          kind: 'p',
          text: `The MOV container itself isn't the problem. It is Apple's take on the same idea as MP4. The trouble is the high bitrate, and the HEVC codec, which some Windows PCs, older Android phones and browsers can't play.`,
        },
      ],
    },
    {
      heading: 'What Snugclip does with a MOV',
      blocks: [
        {
          kind: 'list',
          items: [
            'Converts the HEVC video to H.264 in an MP4 with the Compatible setting, so it plays almost anywhere.',
            'Picks a resolution the size can support. 4K stays 4K only when the budget allows it.',
            'Keeps the picture the right way up. Phones often save rotation as a flag in the file; Snugclip reads it and writes an upright video, so portrait clips stay portrait.',
            'Names the output .mp4, not a mislabelled .mov.',
          ],
        },
      ],
    },
    {
      heading: 'A note on HDR colours',
      blocks: [
        {
          kind: 'p',
          text: 'HDR video holds a wider range of brightness and colour than a normal screen shows. H.264 in Compatible mode is 8-bit standard dynamic range (SDR), so Snugclip converts the HDR picture to SDR. Your browser does the tone mapping, and it is close but not perfect. Colours and bright highlights may shift slightly, and Snugclip shows a note when that happens.',
        },
        {
          kind: 'p',
          text: `The Smaller codecs are SDR too in this version. If the exact HDR look matters, send the original instead, for example as a WhatsApp document (up to ${limit('whatsapp-document')}) or through Telegram (up to ${limit('telegram')}).`,
        },
      ],
    },
    {
      heading: 'Right on the iPhone',
      blocks: [
        {
          kind: 'p',
          text: 'Snugclip runs in Safari on iPhone and iPad. Open the page, tap to pick a video from Photos, and when it is done, share the result straight to Messages or WhatsApp. After the first visit it keeps working without a connection.',
        },
      ],
    },
  ],
  howTo: [
    { title: `Pick where it's going`, body: 'Tap iMessage, WhatsApp, Discord or Email, or leave it at 25 MB for general use.' },
    { title: 'Choose the MOV', body: 'On an iPhone, tap to choose from Photos or Files. On a Mac or PC, drag the .mov file onto the page.' },
    { title: 'Let it convert', body: 'Snugclip decodes the HEVC, turns HDR into SDR if it needs to, and encodes H.264 at a size that fits.' },
    { title: 'Share or save', body: 'Tap Share on a phone, or download the .mp4 on a computer.' },
  ],
  faq: [
    {
      q: 'Will my portrait video come out sideways?',
      a: ['No. Snugclip reads the rotation your phone saved and writes the video upright, so it plays the right way round everywhere.'],
    },
    {
      q: 'Why do the colours look a little different?',
      a: [
        'Your clip was probably recorded in HDR. Snugclip turns it into standard dynamic range so it plays everywhere, and that conversion can shift colours and highlights slightly.',
      ],
    },
    {
      q: 'Can I keep it as a MOV file?',
      a: [
        'Snugclip writes MP4 (or WebM for some Smaller outputs). MP4 plays on iPhones and Macs just as well as MOV, and on many more devices besides.',
      ],
    },
    {
      q: 'What is the iMessage file size limit?',
      a: [
        `Apple doesn't document one. People consistently report about ${limit('imessage')}. Larger videos are sent as iCloud links or recompressed by Messages.`,
      ],
    },
    {
      q: 'Does my video go to a server?',
      a: ['No. It is converted in your browser, and the video never leaves your device.'],
    },
  ],
  related: ['compress-mp4', 'compress-video-for-whatsapp', 'reduce-video-size', 'compress-video-for-email', 'compress-video-without-uploading'],
};

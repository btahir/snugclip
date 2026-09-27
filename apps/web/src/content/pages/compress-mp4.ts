import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-mp4',
  navLabel: 'Compress MP4',
  title: 'Compress MP4 Files to an Exact Size | Snugclip',
  description: `Compress an MP4 to an exact size in your browser. Snugclip re-encodes the H.264, HEVC or AV1 video inside, skips files that already fit, and never uploads them.`,
  h1: 'Compress MP4',
  lede: `MP4 is the most common video file there is, and one of the easiest to shrink. Snugclip fits an MP4 under the size you pick, on your own device.`,
  eyebrow: { glyph: 'size', label: 'MP4', value: limit('size-25') },
  target: { preset: 'size-25' },
  glassLabel: limit('size-25'),
  limits: {
    heading: 'Common targets for MP4 files',
    intro: `An MP4 has no size limit of its own. The limit comes from wherever you are sending it. These are the targets people pick most often. The tool opens at ${limit('size-25')} here, but you can switch to any chip or type your own size. Checked ${checked()}.`,
    rows: [
      { label: 'Discord, free account', value: limit('discord') },
      { label: 'Gmail attachment', value: limit('gmail') },
      { label: 'WhatsApp video', value: limit('whatsapp') },
      { label: 'Common upload form', value: limit('size-25') },
    ],
    sources: [
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
      { label: 'Gmail Help: Attachment size limits', url: presetInfo('gmail').sourceUrl },
      { label: 'WhatsApp Help Center', url: presetInfo('whatsapp').sourceUrl },
      { label: 'BIPM: SI prefixes (mega means one million)', url: presetInfo('size-25').sourceUrl },
    ],
    unitNote: `Snugclip's sizes are decimal (1 MB = 1,000,000 bytes). Your computer may show the same file in MiB, which makes it look about 5% smaller. Aiming for decimal means the file fits whichever unit the other side uses.`,
  },
  sections: [
    {
      heading: 'MP4 is a box, not a codec',
      blocks: [
        {
          kind: 'p',
          text: 'An MP4 file is a container: a box that holds a video track, an audio track and some timing information. What decides the size and quality is the codec used for the tracks inside it. Most MP4s from phones, cameras and screen recorders use H.264. Newer phones and apps may use HEVC, also called H.265, and some use AV1. The audio is usually AAC.',
        },
        {
          kind: 'p',
          text: 'So compressing an MP4 really means re-encoding the video track inside it at a lower bitrate, and sometimes at a lower resolution or frame rate. Renaming the file or moving the tracks into a new box does not make it smaller.',
        },
      ],
    },
    {
      heading: 'What Snugclip writes',
      blocks: [
        {
          kind: 'p',
          text: 'With Compatible, the default, you get H.264 video and AAC audio in an MP4. That plays almost everywhere: phones, laptops, TVs, chat apps and browsers. With Smaller, Snugclip uses AV1 where your browser can encode it, or HEVC otherwise. The file looks better at the same size, but some devices will not play it.',
        },
        {
          kind: 'p',
          text: 'Now and then the chosen codec needs a WebM file instead of an MP4. When that happens, Snugclip gives the file the right extension, so it never pretends to be something it is not.',
        },
      ],
    },
    {
      heading: 'Already small enough? It is left alone',
      blocks: [
        {
          kind: 'p',
          text: 'If your MP4 is already under the target, Snugclip hands it back untouched, byte for byte. Re-encoding a file that fits would only cost quality. If you want a smaller copy anyway, you can choose to re-encode it.',
        },
        {
          kind: 'p',
          text: 'Batches work the same way. Drop in twenty MP4s, and the ones that already fit pass straight through while the rest are compressed.',
        },
      ],
    },
    {
      heading: 'Large MP4s',
      blocks: [
        {
          kind: 'p',
          text: 'Snugclip reads a file in pieces instead of loading all of it into memory, so MP4s of 4 GB and more work, even on an ordinary laptop. Long files take a while to encode. The progress bar shows an estimate, and you can pause or cancel at any point.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Choose a size', body: 'Keep the 25 MB default, tap a destination, or type a custom number.' },
    { title: 'Drop the MP4', body: 'Add one file or many. Snugclip reads the codec, resolution, frame rate and length of each before planning.' },
    { title: 'Pick Compatible or Smaller', body: 'Compatible gives H.264 in MP4 that plays everywhere. Smaller squeezes in more detail but may not play on older devices.' },
    { title: 'Download', body: 'Files are named like clip-snug-25MB.mp4, so you can tell them apart from the originals.' },
  ],
  faq: [
    {
      q: 'Does compressing an MP4 lose quality?',
      a: [
        'Some, because the video is re-encoded with fewer bits. How much depends on the size you pick and the length of the clip. The before and after view and the quality badge let you judge it before you download.',
      ],
    },
    {
      q: 'Will the result still be an MP4?',
      a: [
        'Yes, with the Compatible setting it is always an MP4 with H.264 video and AAC audio. Only some Smaller outputs may come out as WebM, and they are named that way.',
      ],
    },
    {
      q: 'Is H.264 or HEVC better inside an MP4?',
      a: [
        'HEVC gives a better picture at the same size. H.264 plays on far more devices. For a file you are sending to other people, H.264 is the safer choice.',
      ],
    },
    {
      q: 'My MP4 is already small. What happens?',
      a: ['If it is under the target, Snugclip returns it exactly as it was. You can still ask for a re-encode if you want it smaller.'],
    },
    {
      q: 'Is my MP4 uploaded anywhere?',
      a: ['No. The work happens in your browser, and the video never leaves your device.'],
    },
  ],
  related: ['compress-mov', 'reduce-video-size', 'compress-video-to-25mb', 'compress-video-for-discord', 'compress-video-without-uploading'],
};

import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-for-whatsapp',
  navLabel: 'For WhatsApp',
  title: 'Compress Video for WhatsApp: Real Size Limits | Snugclip',
  description: `Compress a video for WhatsApp under the real ${limit('whatsapp')} limit, not the old 16 MB one. Snugclip caps at 720p, never goes over, and keeps the clip private.`,
  h1: 'Compress video for WhatsApp',
  lede: `WhatsApp's video limit is much bigger than the 16 MB most sites still quote. Snugclip fits your clip under the safe ${limit('whatsapp')} figure, at 720p, on your own device.`,
  eyebrow: { glyph: 'whatsapp', label: 'WhatsApp', value: limit('whatsapp') },
  target: { preset: 'whatsapp' },
  glassLabel: limit('whatsapp'),
  limits: {
    heading: 'WhatsApp video and document limits',
    intro: `WhatsApp's Help Center says the default video limit is ${limit('size-100')} at 720p on a faster connection, and ${limit('whatsapp')} at 480p on a slower one. You can't always tell which you'll get, so Snugclip aims for ${limit('whatsapp')} and caps the picture at 720p. Sent as a document instead, a video can be as big as ${limit('whatsapp-document')}. Checked ${checked()}.`,
    rows: [
      { label: 'Video, faster connection', value: limit('size-100'), note: 'Up to 720p' },
      { label: 'Video, slower connection', value: limit('whatsapp'), note: 'Up to 480p' },
      { label: 'Snugclip WhatsApp chip', value: limit('whatsapp'), note: 'Capped at 720p' },
      { label: 'Sent as a document', value: limit('whatsapp-document'), note: 'Skips the recompression WhatsApp does' },
    ],
    sources: [{ label: 'WhatsApp Help Center: sending media and documents', url: presetInfo('whatsapp').sourceUrl }],
    unitNote: `WhatsApp writes "MB" without saying which kind. Snugclip reads it as decimal (1 MB = 1,000,000 bytes), which is the smaller reading, so the file is under the limit whichever one WhatsApp means.`,
  },
  sections: [
    {
      heading: 'Forget the 16 MB number',
      blocks: [
        {
          kind: 'p',
          text: `For years WhatsApp capped videos at 16 MB, and almost every guide online still says so. WhatsApp's own help page no longer does. It now lists the ${limit('size-100')} and ${limit('whatsapp')} defaults shown above. If you have been cutting clips down to 16 MB, you have been throwing away far more quality than you needed to.`,
        },
        {
          kind: 'p',
          text: `Snugclip uses the lower ${limit('whatsapp')} figure on purpose. A file that fits the slow-connection limit sends on either kind of connection, so you never have to guess which one WhatsApp thinks you are on.`,
        },
      ],
    },
    {
      heading: 'Why Snugclip stops at 720p',
      blocks: [
        {
          kind: 'p',
          text: 'When you send a video as media, WhatsApp brings it down to 720p, or 480p on a slow connection. Anything above 720p is thrown away on its side, so spending bytes on 1080p or 4K would be wasted. Snugclip caps the output at 720p and puts the saved bits into a cleaner picture at that size.',
        },
        {
          kind: 'p',
          text: 'WhatsApp may still recompress the file after you send it. Snugclip cannot stop that, but it can make sure the file you hand over already fits, so WhatsApp never refuses it for size.',
        },
      ],
    },
    {
      heading: 'Media or document?',
      blocks: [
        {
          kind: 'p',
          text: `When you attach a video from your gallery, WhatsApp treats it as media: it shows a preview, plays in the chat, and gets recompressed. When you attach it with the Document option, WhatsApp sends the file as it is, up to ${limit('whatsapp-document')}.`,
        },
        {
          kind: 'list',
          items: [
            'Media: plays in the chat, may be recompressed, and follows the video limits above.',
            `Document: arrives byte for byte, up to ${limit('whatsapp-document')}, and opens in the phone's video player.`,
          ],
        },
        {
          kind: 'p',
          text: 'If quality matters more than convenience, send it as a document. The "as document" chip in Snugclip targets that bigger limit, so even long videos fit.',
        },
      ],
    },
    {
      heading: 'A note on Status',
      blocks: [
        {
          kind: 'p',
          text: 'WhatsApp Status has its own rule: a Status video can be up to 90 seconds long. That is a length limit, not a size limit, so Snugclip does not enforce it. If you are posting to Status, trim the clip to 90 seconds on the timeline first.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Tap WhatsApp', body: `The chip sets ${limit('whatsapp')} and a 720p cap. Choose "as document" instead if you want to send a large file at full quality.` },
    { title: 'Add the video', body: 'On a phone, tap to pick it from your gallery. On a computer, drop the file onto the page.' },
    { title: 'Compress it', body: 'Snugclip works out the settings and encodes on the phone or computer in your hand. Nothing is uploaded.' },
    { title: 'Share to WhatsApp', body: 'On a phone, tap Share and choose WhatsApp. On a computer, download the file and attach it in WhatsApp Web or the desktop app.' },
  ],
  faq: [
    {
      q: 'What is the WhatsApp video size limit?',
      a: [
        `By default, ${limit('size-100')} at 720p on a faster connection and ${limit('whatsapp')} at 480p on a slower one. Documents, including videos sent as documents, can be up to ${limit('whatsapp-document')}.`,
      ],
    },
    {
      q: 'Is the 16 MB limit still real?',
      a: [
        `No. It is out of date. WhatsApp's help page now gives the ${limit('size-100')} and ${limit('whatsapp')} figures. Many websites simply haven't updated.`,
      ],
    },
    {
      q: 'Why does WhatsApp make my video blurry?',
      a: [
        'When you send a video as media, WhatsApp shrinks it to 720p or 480p and may recompress it. To keep the full quality, send it as a document instead.',
      ],
    },
    {
      q: 'How do I send a long video on WhatsApp?',
      a: [
        `Send it as a document, which allows up to ${limit('whatsapp-document')}, or trim it and compress it with the WhatsApp chip so it plays in the chat.`,
      ],
    },
    {
      q: 'How long can a WhatsApp Status video be?',
      a: ['Up to 90 seconds. Trim longer clips before you post them to Status.'],
    },
    {
      q: 'Does Snugclip see my video?',
      a: ['No. It runs in your browser, and the video never leaves your device.'],
    },
  ],
  related: ['compress-video-for-discord', 'compress-video-for-email', 'compress-mov', 'reduce-video-size', 'compress-video-without-uploading'],
};

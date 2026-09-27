import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-without-uploading',
  navLabel: 'Without uploading',
  title: 'Compress Video Without Uploading, Free | Snugclip',
  description: `Compress video without uploading it. Snugclip runs in your browser with WebCodecs, works offline after the first visit, and adds no watermark and no account.`,
  h1: 'Compress video without uploading',
  lede: `Most online compressors send your video to their server. Snugclip doesn't: the video never leaves your device, and you can check that for yourself.`,
  eyebrow: { glyph: 'custom', label: 'On your device', value: limit('size-25') },
  target: { preset: 'size-25' },
  glassLabel: limit('size-25'),
  limits: {
    heading: 'Every target works offline',
    intro: `Working locally doesn't change the limits you need to hit. The tool opens at ${limit('size-25')} here, and every destination chip works the same with or without a connection. Checked ${checked()}.`,
    rows: [
      { label: 'Discord, free account', value: limit('discord') },
      { label: 'WhatsApp video', value: limit('whatsapp') },
      { label: 'Email (Gmail and Outlook)', value: limit('email') },
      { label: 'Slack', value: limit('slack') },
    ],
    sources: [
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
      { label: 'WhatsApp Help Center', url: presetInfo('whatsapp').sourceUrl },
      { label: 'Microsoft Support: Reduce attachment size in Outlook', url: presetInfo('email').sourceUrl },
      { label: 'Slack Help: Add files to Slack', url: presetInfo('slack').sourceUrl },
    ],
    unitNote: `Sizes are decimal: 1 MB = 1,000,000 bytes. When a service doesn't say whether it means MB or MiB, the decimal figure is the smaller one, so Snugclip's file fits under either.`,
  },
  sections: [
    {
      heading: 'How it works without a server',
      blocks: [
        {
          kind: 'p',
          text: `Modern browsers include WebCodecs, a built-in way for a web page to decode and encode video using your device's own video hardware or software. Snugclip reads your file, decodes it frame by frame, scales it, encodes it again and writes a new MP4, all inside the browser tab. The file is read from your disk and the result is saved back to your device.`,
        },
        {
          kind: 'p',
          text: `No server does the work, because there is no server at all. Snugclip is a static site. Once the page's own files have loaded, there is nothing on the other end to send your video to.`,
        },
      ],
    },
    {
      heading: 'Check it yourself in DevTools',
      blocks: [
        {
          kind: 'p',
          text: `You don't have to take our word for it. Your browser can show every request a page makes:`,
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            'Open Snugclip in a desktop browser.',
            'Open DevTools (F12, or Cmd+Option+I on a Mac) and switch to the Network tab.',
            'Clear the list, then drop in a video and compress it.',
            'Watch the list stay empty while it works.',
          ],
        },
        {
          kind: 'p',
          text: 'Snugclip makes zero network requests after the page loads. There are no analytics, no fonts from other sites and no tracking pixels.',
        },
      ],
    },
    {
      heading: 'It works offline too',
      blocks: [
        {
          kind: 'p',
          text: 'After your first visit, Snugclip saves its own files on your device as an installable web app. Turn on airplane mode, reload the page, and it still compresses. That is handy on a train or a plane, and it is one more way to be sure nothing is being sent.',
        },
        {
          kind: 'p',
          text: 'You can add it to your home screen or dock, and it opens like any other app.',
        },
      ],
    },
    {
      heading: 'No watermark, no account',
      blocks: [
        {
          kind: 'p',
          text: 'Snugclip is free and open source under the MIT licence. There is no sign-up, no daily cap and no watermark stamped on your video. The code is public, so anyone can read exactly what it does. It shows a before and after preview so you can check the result, and it never gives you a file over the limit.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Open the page once', body: 'The first visit loads Snugclip and stores it for offline use. After that it no longer needs the internet.' },
    { title: 'Drop in a video', body: 'Your browser reads the file straight from your disk. Nothing is copied to anyone else.' },
    { title: 'Compress on the spot', body: `Your device's encoder does the work, so the speed depends on your hardware, not on an upload queue.` },
    { title: 'Keep the result', body: 'Download the file or share it from your phone. Close the tab and there is nothing left on any server, because nothing was ever there.' },
  ],
  faq: [
    {
      q: 'Is my video really not uploaded?',
      a: [
        'Yes. The whole job runs in your browser tab. Open the Network tab in your browser DevTools while it works and you will see no requests at all.',
      ],
    },
    {
      q: 'Does it work offline?',
      a: ['Yes, after your first visit. Snugclip stores itself on your device, so you can compress in airplane mode.'],
    },
    {
      q: 'Is there a watermark or a sign-up?',
      a: ['Neither. Snugclip is free, open source under MIT, and needs no account. Your video comes out without any marks added.'],
    },
    {
      q: 'Which browsers work?',
      a: [
        'Recent versions of Chrome, Edge and Safari have the WebCodecs features Snugclip needs. If your browser lacks something, Snugclip tells you plainly instead of failing quietly.',
      ],
    },
    {
      q: 'Is it slower than an online compressor?',
      a: [
        'It depends on your device. You skip the upload and the download entirely, which for a big file often takes longer than the encode itself.',
      ],
    },
  ],
  related: ['compress-mp4', 'compress-mov', 'reduce-video-size', 'compress-video-for-whatsapp', 'compress-video-for-discord'],
};

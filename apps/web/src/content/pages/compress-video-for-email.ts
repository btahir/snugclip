import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-for-email',
  navLabel: 'For email',
  title: 'Compress Video for Email (Gmail and Outlook) | Snugclip',
  description: `Compress a video for email. Gmail's 25 MB and Outlook's 20 MB include encoding, so Snugclip targets ${limit('gmail')} or ${limit('outlook')} for the video and never goes over.`,
  h1: 'Compress video for email',
  lede: `Email limits count more than your video, so a file that looks small enough often bounces. Snugclip does the maths and fits the clip at ${limit('email')} or less, which works in Gmail and Outlook.`,
  eyebrow: { glyph: 'email', label: 'Email', value: limit('email') },
  target: { preset: 'email' },
  glassLabel: limit('email'),
  limits: {
    heading: 'Email limits, and what they really allow',
    intro: `Gmail allows messages up to ${limit('size-25')} on personal accounts. Microsoft's Outlook support page says 20 MB, though other Microsoft pages give 25 MB or 34 MB for Outlook.com and 35 MB for Exchange Online. Every one of these counts the encoded message, not the raw file. Snugclip uses the strictest common figure, Outlook's 20 MB, so its Email chip fits both services. Checked ${checked('email')}.`,
    rows: [
      { label: 'Gmail message limit', value: limit('size-25') },
      { label: 'Largest video for Gmail', value: limit('gmail') },
      { label: 'Outlook message limit', value: '20 MB', note: 'Microsoft pages conflict; this is the lowest' },
      { label: 'Largest video for Outlook', value: limit('outlook') },
      { label: 'Snugclip Email chip (Any)', value: limit('email'), note: 'Fits Gmail and Outlook' },
    ],
    sources: [
      { label: 'Gmail Help: Attachment size limits', url: presetInfo('gmail').sourceUrl },
      { label: 'Google Workspace: Gmail receiving limits (37% encoding)', url: 'https://knowledge.workspace.google.com/admin/gmail/gmail-receiving-limits-in-google-workspace' },
      { label: 'Microsoft Support: Reduce attachment size in Outlook', url: presetInfo('outlook').sourceUrl },
      { label: 'Microsoft Learn: Attachment size exceeds the allowable limit', url: 'https://learn.microsoft.com/en-us/troubleshoot/outlook/message-body/attachment-size-exceeds-the-allowable-limit-error' },
      { label: 'Microsoft Learn: Exchange Online limits (33% encoding)', url: 'https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits' },
    ],
    unitNote: `All sizes here are decimal: 1 MB = 1,000,000 bytes. Mail services don't always say whether they mean MB or MiB, and the decimal reading is the smaller one, so a file sized for it fits under either.`,
  },
  sections: [
    {
      heading: 'Why email makes files bigger',
      blocks: [
        {
          kind: 'p',
          text: 'Email was built for text. To send a video, your mail app converts it into letters and numbers using base64. Every 3 bytes of video become 4 characters, a third bigger, and line breaks add a little more. Google says the total increase is about 37%, and Microsoft says about 33%. The message text, your signature and the headers come on top.',
        },
        {
          kind: 'p',
          text: 'So the limit on the help page is not the size of video you can attach. It is the size of the whole encoded message, and the video has to be quite a bit smaller.',
        },
      ],
    },
    {
      heading: 'The worked example',
      blocks: [
        {
          kind: 'p',
          text: 'Snugclip uses one formula for every email limit: take the limit, subtract about 64,000 bytes for the text and headers, then divide by 1.37 for the encoding.',
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            `Gmail: 25,000,000 minus 64,000 is 24,936,000. Divided by 1.37, that is about 18.2 million bytes. Snugclip rounds down to ${limit('gmail')}.`,
            `Outlook: 20,000,000 minus 64,000 is 19,936,000. Divided by 1.37, that is about 14.55 million bytes, rounded down to ${limit('outlook')}.`,
          ],
        },
        {
          kind: 'p',
          text: `Using Google's 1.37 rather than Microsoft's 1.33 leaves a little spare room, which is what you want when a bounce means starting over.`,
        },
      ],
    },
    {
      heading: 'Gmail, Outlook or Any',
      blocks: [
        {
          kind: 'p',
          text: `The Email chip opens three choices. Gmail gives you the most room at ${limit('gmail')}. Outlook fits Microsoft accounts at ${limit('outlook')}. Any uses the Outlook number, because a video that fits Outlook fits Gmail too. If you are writing to several people, or you are not sure which service each one uses, pick Any.`,
        },
      ],
    },
    {
      heading: 'When the video is too long for email',
      blocks: [
        {
          kind: 'p',
          text: `Some clips can't squeeze into ${limit('gmail')} and still look good, like a twenty-minute recording. Then a link is the better choice. Gmail offers to put large files in Google Drive and send a link, and Outlook can do the same with OneDrive. The other person gets the full-quality file and your email stays small.`,
        },
        {
          kind: 'p',
          text: 'Snugclip still helps there. A smaller file uploads to Drive or OneDrive faster and takes up less of your storage.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Open the Email chip', body: 'Choose Gmail, Outlook or Any. Any is the default because it fits both.' },
    { title: 'Add your clip', body: `Drop it in or pick it from your files. Trim away anything the other person doesn't need to see.` },
    { title: 'Compress below the email line', body: 'Snugclip aims for the raw size that survives encoding, not the headline limit, and checks the finished file against it.' },
    { title: 'Attach and send', body: 'Download the file and attach it as normal. Keep the message short, because big pasted images count toward the limit too.' },
  ],
  faq: [
    {
      q: 'What is the Gmail attachment size limit?',
      a: [
        `Gmail allows messages up to ${limit('size-25')}, measured after encoding. That leaves room for a video of about ${limit('gmail')}.`,
      ],
    },
    {
      q: 'Why did my 20 MB video bounce from Outlook?',
      a: [
        `Outlook's 20 MB covers the whole message after encoding, which adds 33 to 37%. A 20 MB video grows to about 27 MB. Aim for ${limit('outlook')} or less.`,
      ],
    },
    {
      q: `Why do Microsoft's pages give different limits?`,
      a: [
        'Different Microsoft pages list 20, 25 and 34 MB for Outlook, and Exchange Online defaults to 35 MB. They cover different products and settings, and they disagree. Snugclip uses the lowest, 20 MB, so the video fits whichever applies.',
      ],
    },
    {
      q: 'Can I send a bigger video by email?',
      a: [
        'Not as an attachment. Share it as a Google Drive or OneDrive link instead. Compressing it first still makes the upload quicker.',
      ],
    },
    {
      q: 'Is my video uploaded to compress it?',
      a: ['No. Snugclip compresses in your browser. The video never leaves your device until you attach it yourself.'],
    },
  ],
  related: ['compress-video-to-25mb', 'compress-video-to-20mb', 'compress-video-for-whatsapp', 'reduce-video-size', 'compress-video-without-uploading'],
};

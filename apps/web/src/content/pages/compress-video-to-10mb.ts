import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-to-10mb',
  navLabel: 'To 10 MB',
  title: 'Compress Video to 10MB for Discord or GitHub | Snugclip',
  description: `Compress a video to 10 MB for Discord accounts still on the old cap, or for GitHub's free-plan video limit. Runs in your browser and never goes over 10 MB.`,
  h1: 'Compress video to 10 MB',
  lede: `Ten megabytes is Discord's previous free limit and GitHub's cap for videos on free plans. Snugclip fits your clip under it without sending it anywhere.`,
  eyebrow: { glyph: 'size', label: 'Exact size', value: limit('size-10') },
  target: { preset: 'size-10' },
  glassLabel: limit('size-10'),
  limits: {
    heading: 'Who still uses 10 MB',
    intro: `From 2025 until August 2026, a free Discord account could upload ${limit('size-10')}. Discord has raised that to ${limit('discord')}, but it is switching accounts over gradually, so plenty of people still hit the ${limit('size-10')} wall. GitHub also caps video attachments at ${limit('size-10')} on its free plan, which matters if you drop screen recordings into issues and pull requests. Checked ${checked()}.`,
    rows: [
      { label: 'This target', value: limit('size-10'), note: '10,000,000 bytes' },
      { label: 'Discord free, 2025 to Aug 2026', value: limit('size-10'), note: 'Some accounts still have it' },
      { label: 'Discord free, new limit', value: limit('discord') },
      { label: 'GitHub video attachment, free plan', value: limit('size-10') },
    ],
    sources: [
      { label: 'BIPM: SI prefixes (mega means one million)', url: presetInfo('size-10').sourceUrl },
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord').sourceUrl },
      { label: 'GitHub Docs: Attaching files', url: 'https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files' },
    ],
    unitNote: `10 MB here is 10,000,000 bytes. A site that means 10 MiB allows 10,485,760 bytes, a bit more. Snugclip aims for the smaller decimal figure, so its file passes either way.`,
  },
  sections: [
    {
      heading: 'Still seeing 10 MB on Discord?',
      blocks: [
        {
          kind: 'p',
          text: `Discord's help page now says free accounts can send ${limit('discord')}, and also that it is testing different limits for different people. If Discord refuses a file that sits between the two numbers, your account hasn't moved to the new limit yet. No setting will change that. Until it switches, ${limit('size-10')} is the size to aim for.`,
        },
        {
          kind: 'p',
          text: `There is an upside. The limit belongs to the person uploading, and a ${limit('size-10')} file works on every free account, old cap or new. If you are making a clip for someone else to post, this is the size that can't fail on them.`,
        },
      ],
    },
    {
      heading: 'Videos in GitHub issues and pull requests',
      blocks: [
        {
          kind: 'p',
          text: `GitHub lets you drag a video into an issue, a pull request or a comment, and it plays right there on the page. On the free plan the cap for videos is ${limit('size-10')}. A screen recording of a bug can pass that fast, because captures of a large screen at 60 fps are heavy.`,
        },
        {
          kind: 'p',
          text: 'The good news is that screen recordings shrink very well, since most of the screen sits still. Snugclip measures the clip with short test encodes before the real one, so the bits go where the motion is and text in a terminal or app stays readable. If the recording is long, trim it to the moment the bug shows up. Reviewers will thank you.',
        },
      ],
    },
    {
      heading: 'What 10 MB buys',
      blocks: [
        {
          kind: 'p',
          text: `10 MB is 80 million bits, or about 1.3 megabits per second over a one-minute clip. The table shows what Snugclip's planner would choose for a 1080p, 30 fps clip at four different lengths.`,
        },
        { kind: 'planTable', bytes: 10 * 1_000_000, caption: 'What the planner picks at 10 MB for a 1080p, 30 fps source' },
        {
          kind: 'p',
          text: 'Compared with 8 MB, you get a quarter more bits for the same length. The planner spends them on a higher resolution or frame rate wherever the numbers allow it.',
        },
      ],
    },
  ],
  howTo: [
    { title: 'Tap 10 MB', body: `The 10 MB chip sets the target to 10,000,000 bytes, which fits both Discord's older free cap and GitHub's free-plan limit.` },
    { title: 'Drop the recording in', body: 'MP4, MOV, WebM and MKV files all work. For a screen recording, trim to the part that shows the problem.' },
    { title: 'Compress on your device', body: 'Snugclip picks the settings, runs a few quick test encodes, then makes the file. It keeps correcting until the size is under the line.' },
    { title: 'Attach it', body: `Download the file and drag it into Discord or a GitHub comment. It is under ${limit('size-10')}, so it won't be refused for size.` },
  ],
  faq: [
    {
      q: `Why won't Discord take my file when the limit is ${limit('discord')}?`,
      a: [
        `Your account is probably still on the old ${limit('size-10')} cap. Discord is rolling the higher limit out in stages. Compress to ${limit('size-10')} for now and the upload will go through.`,
      ],
    },
    {
      q: `Does GitHub's ${limit('size-10')} video limit apply to paid plans?`,
      a: [
        `No, the ${limit('size-10')} cap is for free plans. Paid plans allow larger videos. GitHub's page on attaching files lists the limit for each plan.`,
      ],
    },
    {
      q: 'Will a screen recording stay readable at 10 MB?',
      a: [
        'Usually, yes, as long as it is not very long. Record only the window you need rather than a whole large screen, and trim the dead time at the start and end.',
        'Snugclip also shows a quality badge and a before and after view, so you can check the text is sharp before you post it.',
      ],
    },
    {
      q: 'Is 10 MB the same as 10 MiB?',
      a: [
        'Not quite. 10 MB is 10,000,000 bytes and 10 MiB is 10,485,760 bytes. Snugclip uses the smaller decimal number, so the file fits either kind of limit.',
      ],
    },
    {
      q: 'Does anything get uploaded while it compresses?',
      a: ['No. Everything happens in your browser. The video never leaves your device.'],
    },
  ],
  related: ['compress-video-for-discord', 'compress-video-to-8mb', 'compress-video-to-20mb', 'compress-video-to-25mb', 'compress-mp4'],
};

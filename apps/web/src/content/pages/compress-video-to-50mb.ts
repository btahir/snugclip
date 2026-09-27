import { checked, limit, presetInfo } from '../presetInfo';
import type { KeywordPage } from '../types';

export const page: KeywordPage = {
  slug: 'compress-video-to-50mb',
  navLabel: 'To 50 MB',
  title: 'Compress Video to 50MB for Nitro Basic | Snugclip',
  description: `Compress a video to 50 MB for Discord Nitro Basic or a Boost level 2 server. Snugclip keeps 1080p where it can, never goes over, and never uploads your clip.`,
  h1: 'Compress video to 50 MB',
  lede: `50 MB is the upload limit for Discord Nitro Basic and for servers at Boost level 2. Snugclip fits longer clips under it without sending them anywhere.`,
  eyebrow: { glyph: 'size', label: 'Exact size', value: limit('size-50') },
  target: { preset: 'size-50' },
  glassLabel: limit('size-50'),
  limits: {
    heading: '50 MB on Discord',
    intro: `Discord's Nitro Basic plan lets you upload files up to ${limit('discord-nitro-basic')}. A server that reaches Boost level 2 gives the same ${limit('discord-nitro-basic')} to everyone who posts there, even people on free accounts. Full Nitro goes up to ${limit('discord-nitro')}, and the free tier sits at ${limit('discord')}. Checked ${checked()}.`,
    rows: [
      { label: 'This target', value: limit('size-50'), note: '50,000,000 bytes' },
      { label: 'Discord Nitro Basic', value: limit('discord-nitro-basic'), note: 'Anywhere on Discord' },
      { label: 'Server Boost level 2', value: limit('discord-nitro-basic'), note: 'Only inside that server' },
      { label: 'Discord Nitro', value: limit('discord-nitro') },
      { label: 'Discord free', value: limit('discord') },
    ],
    sources: [
      { label: 'BIPM: SI prefixes (mega means one million)', url: presetInfo('size-50').sourceUrl },
      { label: 'Discord: File Attachments FAQ', url: presetInfo('discord-nitro-basic').sourceUrl },
      { label: 'Discord: What are Nitro and Nitro Basic?', url: 'https://support.discord.com/hc/en-us/articles/115000435108-What-are-Nitro-Nitro-Basic' },
      { label: 'Discord: Server Boosting FAQ', url: 'https://support.discord.com/hc/en-us/articles/360028038352' },
    ],
    unitNote: `Snugclip counts 50 MB as 50,000,000 bytes. If Discord really measures in MiB, its cap is 52,428,800 bytes, so a decimal 50 MB file clears it with room left over.`,
  },
  sections: [
    {
      heading: 'Nitro Basic and boosted servers',
      blocks: [
        {
          kind: 'p',
          text: `If you pay for Nitro Basic, your uploads can be ${limit('discord-nitro-basic')} anywhere on Discord. If you don't, you can still post files that big in a server at Boost level 2, but only in that server. Move the same clip into a DM or an unboosted server and the free limit applies again.`,
        },
        {
          kind: 'p',
          text: 'That catches people out: a clip that posted fine in one server gets refused in another. If you share in several places, make two versions. Use 50 MB for the boosted server and the Discord chip for everywhere else. Batches make this quick, since you can queue the same file twice with different targets.',
        },
      ],
    },
    {
      heading: 'What 50 MB buys at 1080p',
      blocks: [
        {
          kind: 'p',
          text: `50 MB is 400 million bits. Over one minute that is about 6.7 megabits per second, which for a 1080p, 30 fps clip works out above the 0.08 bits per pixel Snugclip aims for with H.264. In plain terms: a one-minute full HD clip fits with a clean picture. Over five minutes the budget falls to about 1.3 megabits per second, well below that mark, so the planner steps down.`,
        },
        { kind: 'planTable', bytes: 50 * 1_000_000, caption: 'How a 1080p, 30 fps clip is planned at 50 MB as it gets longer' },
        {
          kind: 'p',
          text: 'When the source is sharper than 1080p and the budget allows, Snugclip keeps the extra resolution rather than capping at full HD. It never upscales. For 60 fps sources, the planner keeps 60 only when there are enough bits per pixel for it, and drops to 30 before it lowers the resolution.',
        },
      ],
    },
    {
      heading: 'Tips for long gameplay clips',
      blocks: [
        {
          kind: 'p',
          text: `Game footage is busy, full of motion and fine detail, so it needs more bits than a video call or a slideshow. Snugclip's short test encodes measure that before the real encode, so the file lands close to the limit instead of far under it.`,
        },
        {
          kind: 'list',
          items: [
            'Cut the loading screens and the walk to the action. Those seconds cost the same as the good part.',
            'Keep Compatible for a server, where people watch on all kinds of devices.',
            `If you have full Nitro, use the Nitro chip instead and get up to ${limit('discord-nitro')}.`,
          ],
        },
      ],
    },
  ],
  howTo: [
    { title: 'Choose 50 MB or Nitro Basic', body: 'Both chips target 50,000,000 bytes. Pick Nitro Basic if you like seeing the plan named for you.' },
    { title: 'Add your recording', body: 'Drop in a gameplay clip, a stream highlight or a phone video. Long files are read in pieces, so they do not need to fit in memory.' },
    { title: 'Let the planner work', body: 'It chooses resolution and frame rate, runs quick test encodes, then makes the file and checks it is under 50 MB.' },
    { title: 'Post it where 50 MB applies', body: 'With Nitro Basic that is anywhere. Without it, only in the server that has Boost level 2.' },
  ],
  faq: [
    {
      q: 'Who can upload 50 MB files on Discord?',
      a: [
        `Anyone with Nitro Basic, anywhere on Discord. Everyone else can too, but only inside a server at Boost level 2, which raises the limit to ${limit('discord-nitro-basic')} for all its members.`,
      ],
    },
    {
      q: 'Why was my 50 MB clip refused in a DM?',
      a: [
        `Server boosts only apply inside the boosted server. In DMs and other servers, your own account's limit applies, which is ${limit('discord')} on a free account.`,
      ],
    },
    {
      q: 'Can a 1080p video fit in 50 MB?',
      a: [
        'Yes, for short clips. A one-minute 1080p clip gets a comfortable budget at this size. The table above shows exactly where the planner keeps 1080p and where it steps down for longer clips.',
      ],
    },
    {
      q: 'What about Boost level 3?',
      a: [
        `A server at Boost level 3 allows ${limit('size-100')}. Pick the ${limit('size-100')} chip for those.`,
      ],
    },
    {
      q: 'Does the clip stay private?',
      a: ['Yes. Snugclip compresses in your browser, and the video never leaves your device.'],
    },
  ],
  related: ['compress-video-for-discord', 'compress-video-to-25mb', 'compress-video-to-20mb', 'reduce-video-size', 'compress-mp4'],
};

# Credits

Snugclip is MIT licensed (see `LICENSE`). It builds on the work below. Everything listed is used unmodified.

## Libraries

| Project | Used for | Licence | Source |
|---|---|---|---|
| [Mediabunny](https://mediabunny.dev) | Reading, converting and writing video in the browser (WebCodecs) | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| [@mediabunny/aac-encoder](https://www.npmjs.com/package/@mediabunny/aac-encoder) | AAC audio in browsers without a native AAC encoder (Firefox, older Safari) | MPL-2.0 wrapper; the embedded WebAssembly is FFmpeg's native AAC encoder, **LGPL-2.1-or-later** | https://github.com/Vanilagy/mediabunny/tree/main/packages/aac-encoder · FFmpeg source: https://git.ffmpeg.org/ffmpeg.git |
| [ssim.js](https://github.com/obartra/ssim) | SSIM quality score | MIT | https://github.com/obartra/ssim |
| [Zod](https://zod.dev) | Job file and report schemas | MIT | https://github.com/colinhacks/zod |
| [Serwist](https://serwist.pages.dev) | Offline service worker (precache) | MIT | https://github.com/serwist/serwist |
| [client-zip](https://github.com/Touffy/client-zip) | "Download all" zip, streamed in the browser | MIT | https://github.com/Touffy/client-zip |
| [Next.js](https://nextjs.org), [React](https://react.dev) | Static web app | MIT | https://github.com/vercel/next.js · https://github.com/facebook/react |
| [Tailwind CSS](https://tailwindcss.com) | Styling utilities | MIT | https://github.com/tailwindlabs/tailwindcss |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Local MCP server | MIT | https://github.com/modelcontextprotocol/typescript-sdk |

### About the AAC encoder (LGPL-2.1)

The web app serves `@mediabunny/aac-encoder`'s bundle unmodified as a separate file, `/vendor/aac-encoder-<version>.mjs`, and loads it at runtime only when the browser has no AAC encoder of its own. It is never bundled into Snugclip's own JavaScript, so you can replace that one file with your own build of the encoder. The FFmpeg AAC encoder inside it is licensed under the GNU Lesser General Public License v2.1 or later; its source is available from the FFmpeg project (link above) and from the Mediabunny repository.

The CLI and MCP server call the `ffmpeg`/`ffprobe` binaries you install yourself. Snugclip does not ship or link ffmpeg.

## Typefaces (SIL Open Font License 1.1)

Self-hosted from our own origin (Latin subsets from the `@fontsource-variable` packages); no font CDN.

| Typeface | Designer | Used for |
|---|---|---|
| [Outfit](https://github.com/Outfitio/Outfit-Fonts) | Rodrigo Fuenzalida / Outfit.io | Display type and numbers |
| [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/) | Braille Institute, Applied Design Works | Interface and body text |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | JetBrains | Sizes, metadata and code |

The Snugclip wordmark is lettering outlined from Outfit (SIL OFL 1.1). The logo, app icon, destination glyphs and all other artwork were drawn for Snugclip and are MIT licensed. Platform names are used in text only; no platform logos are included.

## Test media

All test and demo clips are synthetic, generated locally with ffmpeg's test sources (`testsrc2`, noise, tones). No real footage is included.

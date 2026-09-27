import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { GITHUB_URL, SUPPORT_URL } from '@/config/site';

const TITLE = 'About Snugclip: private, on-device video compression';
const DESC =
  'How Snugclip fits a video under an exact size limit without uploading it: WebCodecs in your browser, a measured fit loop, and a quality check you can read.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: '/about/' },
  openGraph: { title: TITLE, description: DESC, url: '/about/', images: [{ url: '/og/default.png', width: 1200, height: 630 }] },
};

export default function AboutPage() {
  return (
    <>
      <Header />
      <main className="wrap" style={{ paddingBottom: 24 }}>
        <section className="page-hero" style={{ gridTemplateColumns: '1fr' }}>
          <div>
            <span className="eyebrow">
              <span className="gl">
                <Icon name="shield" size={16} />
              </span>
              About &amp; privacy
            </span>
            <h1 className="h1">Your video never leaves your device.</h1>
            <p className="lede">
              Snugclip is a free, open-source compressor that fits a clip under an exact size limit and never hands you a file that is over it. It does all the work
              inside your browser.
            </p>
          </div>
        </section>

        <section id="privacy" className="section narrow prose" aria-labelledby="privacy-h">
          <h2 id="privacy-h">Privacy, in plain words</h2>
          <p>
            <b>Nothing is uploaded.</b> When you drop a video, your browser reads it straight from your disk. Decoding, resizing, encoding and the quality check all run
            on your computer or phone, using the video engine built into the browser (WebCodecs).
          </p>
          <p>
            <b>No accounts, no tracking.</b> There is no sign-in, no analytics, no ads and no third-party scripts or fonts. After the page loads, Snugclip makes no network
            requests at all. You can check this yourself: open your browser&apos;s developer tools, go to the Network tab, and compress a clip.
          </p>
          <p>
            <b>Works offline.</b> The first visit saves the app for offline use. After that you can turn off Wi-Fi and it still works, which is also a simple way to be sure
            nothing is sent anywhere.
          </p>
          <p>
            <b>What is stored.</b> Only your last chosen size limit, your theme, and whether you hid the support note, in your browser&apos;s local storage. Your videos and
            results live in memory and disappear when you close the tab.
          </p>
        </section>

        <section id="how" className="section" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="steps">
            <li>
              <span className="n" aria-hidden="true">
                1
              </span>
              <h3>Plan</h3>
              <p>
                Snugclip reads the clip&apos;s length, size and frame rate, then works out a byte budget: the limit, minus a safety margin, container overhead and sound.
                It picks the highest resolution that still gets enough bits per pixel, dropping 60 fps to 30 before it lowers the resolution.
              </p>
            </li>
            <li>
              <span className="n" aria-hidden="true">
                2
              </span>
              <h3>Measure and correct</h3>
              <p>
                Short sample encodes measure how your browser&apos;s encoder really behaves. Then it encodes, checks the exact byte count, and corrects the bitrate if
                needed. An attempt over the limit is thrown away, never saved.
              </p>
            </li>
            <li>
              <span className="n" aria-hidden="true">
                3
              </span>
              <h3>Check how it looks</h3>
              <p>
                It compares matched frames of the original and the result (SSIM and PSNR) and turns that into a plain badge: Looks great, Softer, still clear, or
                Noticeably soft. Then you compare them side by side before you download.
              </p>
            </li>
          </ol>
          <div className="prose narrow" style={{ maxWidth: 720 }}>
            <p>
              If a clip can&apos;t fit even at the lowest sensible quality, Snugclip says so before encoding and tells you the smallest size it can reach, so you can trim
              it, mute it or pick a bigger limit. Files already under the limit are handed back untouched, byte for byte.
            </p>
          </div>
        </section>

        <section id="formats" className="section narrow prose" aria-labelledby="formats-h">
          <h2 id="formats-h">What works</h2>
          <ul>
            <li>
              <b>Files:</b> MP4, MOV, M4V, WebM and MKV with H.264, HEVC, VP9 or AV1 video, up to 4 GB each. Older formats such as AVI, WMV, FLV and MPEG-2 can&apos;t be
              decoded by browsers; the Snugclip command-line tool (with ffmpeg) handles them.
            </li>
            <li>
              <b>Browsers:</b> Chrome, Edge and Brave (desktop and Android), Safari 26 or newer on Mac and iPhone, and Firefox on desktop.
            </li>
            <li>
              <b>Output:</b> MP4 with H.264 and AAC by default (plays everywhere), or smaller AV1/HEVC files for newer devices.
            </li>
          </ul>
        </section>

        <section id="agents" className="section narrow prose" aria-labelledby="agents-h">
          <h2 id="agents-h">For agents and scripts</h2>
          <p>
            The same engine ships as a command-line tool and a local MCP server, using your own installed ffmpeg. Settings can be shared as links (for example{' '}
            <code>/?preset=discord&amp;codec=h264&amp;maxh=720</code>) or as <code>.snugclip.json</code> job files. Details are in{' '}
            <a href="/llms.txt">llms.txt</a> and the repository&apos;s AGENTS.md.
          </p>
          <pre>{`snugclip compress clip.mov --preset discord --json`}</pre>
        </section>

        <section id="credits" className="section narrow prose" aria-labelledby="credits-h">
          <h2 id="credits-h">Credits and licence</h2>
          <p>
            Snugclip is MIT licensed. It stands on <a href="https://mediabunny.dev">Mediabunny</a> (MPL-2.0) for reading and writing video files, the FFmpeg AAC encoder
            (LGPL-2.1, loaded as a separate file only when a browser has no AAC encoder of its own), and the Outfit, Atkinson Hyperlegible Next and JetBrains Mono
            typefaces (SIL Open Font License). The full list is in CREDITS.md in the <a href={GITHUB_URL}>source code</a>.
          </p>
          <p>
            Snugclip is free. If it saved you a failed upload, you can <Link href={SUPPORT_URL}>support it</Link>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}

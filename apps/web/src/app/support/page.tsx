import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { HeroGlass } from '@/components/site/HeroGlass';
import { DONATION_LINKS, GITHUB_URL } from '@/config/site';

const TITLE = 'Support Snugclip';
const DESC =
  'Snugclip is free, open source and runs on your device. If it saved you a failed upload, you can support it with a one-off tip or a small monthly amount.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESC,
  alternates: { canonical: '/support/' },
  openGraph: { title: TITLE, description: DESC, url: '/support/', images: [{ url: '/og/default.png', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/og/default.png'] },
};

function PayLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  if (!href)
    return (
      <span className={className} aria-disabled="true" title="Coming soon">
        {children}
      </span>
    );
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function SupportPage() {
  return (
    <>
      <Header />
      <main className="wrap" style={{ paddingBottom: 24 }}>
        <section className="support-hero" aria-labelledby="support-title">
          <div>
            <span className="eyebrow">
              <span className="gl">
                <Icon name="heart" size={15} />
              </span>
              Support this project
            </span>
            <h1 className="h1" id="support-title">
              Keep it snug, keep it free.
            </h1>
            <p className="lede">
              Snugclip costs nothing to use and never will: no account, no watermark, no upload. Support is voluntary. It pays for the evenings that go into fixes, new
              presets and keeping the limits up to date. Every feature stays free and MIT licensed either way.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
              <PayLink href={DONATION_LINKS.once} className="btn primary lg">
                <Icon name="heart" size={18} /> Give once
              </PayLink>
              <a className="btn lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="github" size={18} /> Star the repo
              </a>
            </div>
            <p style={{ fontSize: 13, marginTop: 10, color: 'var(--sn-ink-3)' }}>Choose your own amount. Whatever feels right for a file that finally fit.</p>

            <h2 style={{ font: '600 var(--sn-text-lg)/1.25 var(--sn-font-display)', marginTop: 34 }}>Or support monthly</h2>
            <div className="tiers">
              {DONATION_LINKS.monthly.map((tier) => (
                <PayLink key={tier.label} href={tier.href} className="tier">
                  <b>{tier.label}</b>
                  <span>/mo · {tier.note}</span>
                </PayLink>
              ))}
            </div>
            <p style={{ fontSize: 13, marginTop: 10, color: 'var(--sn-ink-3)' }}>Payments are handled by Stripe. Monthly support renews until you cancel.</p>
            <p style={{ marginTop: 26, color: 'var(--sn-ink-2)' }}>
              Not in a position to give? Telling a friend, starring the repo or{' '}
              <a className="link" href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">
                reporting a bug
              </a>{' '}
              helps just as much.{' '}
              <Link className="link" href="/">
                Back to the tool
              </Link>
            </p>
          </div>
          <div className="illo">
            <HeroGlass label="Thank you" />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

import { formatDuration, resolveTarget, targetLabel } from '@snugclip/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Footer } from '@/components/site/Footer';
import { Header } from '@/components/site/Header';
import { HeroGlass } from '@/components/site/HeroGlass';
import { Tool } from '@/components/tool/Tool';
import { SITE_URL } from '@/config/site';
import { KEYWORD_PAGES, getKeywordPage } from '@/content/pages';
import { planTable } from '@/content/planTable';
import { checked } from '@/content/presetInfo';
import type { Block } from '@/content/types';
import { formatSize } from '@/lib/format';

export const dynamicParams = false;

export function generateStaticParams() {
  return KEYWORD_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = getKeywordPage((await params).slug);
  if (!p) return {};
  const url = `/${p.slug}/`;
  return {
    title: { absolute: p.title },
    description: p.description,
    alternates: { canonical: url },
    openGraph: { title: p.title, description: p.description, url, type: 'website', images: [{ url: `/og/${p.slug}.png`, width: 1200, height: 630, alt: p.h1 }] },
    twitter: { card: 'summary_large_image', title: p.title, description: p.description, images: [`/og/${p.slug}.png`] },
  };
}

function PlanTable({ bytes, caption }: { bytes: number; caption: string }) {
  const rows = planTable(bytes);
  return (
    <div className="table-card">
      <div className="scroll">
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">1080p30 clip length</th>
              <th scope="col">What Snugclip picks</th>
              <th scope="col">Video</th>
              <th scope="col">Sound</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.durationSec}>
                <td className="num">{formatDuration(r.durationSec)}</td>
                <td>{r.feasible ? `${r.resolution} at ${r.fps} fps` : `Too long: needs at least ${formatSize(r.minimumBytes, { round: 'ceil' })}`}</td>
                <td className="num">{r.feasible ? `${r.videoKbps} kbps` : '—'}</td>
                <td className="num">{r.feasible ? (r.audioKbps ? `${r.audioKbps} kbps` : 'muted') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="foot">{caption} Worked out by the same planner the tool uses, for a {targetLabel(bytes)} target.</p>
    </div>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.kind === 'p') return <p>{b.text}</p>;
  if (b.kind === 'list') {
    const items = b.items.map((x) => <li key={x}>{x}</li>);
    return b.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  return <PlanTable bytes={b.bytes} caption={b.caption} />;
}

export default async function KeywordLanding({ params }: { params: Promise<{ slug: string }> }) {
  const p = getKeywordPage((await params).slug);
  if (!p) notFound();
  const target = resolveTarget(p.target.preset ? { preset: p.target.preset } : { size: p.target.size! });
  const related = p.related.map((s) => getKeywordPage(s)).filter((x) => !!x);
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.join(' ') } })),
  };
  const appLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Snugclip',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (web browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    url: `${SITE_URL}/${p.slug}/`,
  };
  return (
    <>
      <Header />
      <main className="wrap">
        <section className="page-hero">
          <div>
            <span className="eyebrow">
              <span className="gl">
                <Icon name={p.eyebrow.glyph} size={16} />
              </span>
              {p.eyebrow.label} · <span className="mono">{p.eyebrow.value}</span>
            </span>
            <h1 className="h1">{p.h1}</h1>
            <p className="lede">{p.lede}</p>
          </div>
          <div className="hero-glass">
            <HeroGlass label={p.glassLabel} />
          </div>
        </section>

        <Tool initialTarget={target} />

        <section className="section" aria-labelledby="limits">
          <h2 id="limits">{p.limits.heading}</h2>
          <div className="prose narrow" style={{ maxWidth: 720 }}>
            <p>{p.limits.intro}</p>
          </div>
          <div className="table-card">
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Where</th>
                    <th scope="col">Limit</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {p.limits.rows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="num">{r.value}</td>
                      <td>{r.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="foot">
              Sources, checked {checked()}:{' '}
              {p.limits.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ' · '}
                  <a href={s.url} rel="noreferrer">
                    {s.label}
                  </a>
                </span>
              ))}
              . {p.limits.unitNote}
            </p>
          </div>
        </section>

        {p.sections.map((s, i) => (
          <section key={s.heading} className="section narrow prose" aria-labelledby={`s${i}`}>
            <h2 id={`s${i}`}>{s.heading}</h2>
            {s.blocks.map((b, j) => (
              <BlockView key={j} b={b} />
            ))}
          </section>
        ))}

        <section className="section" aria-labelledby="howto">
          <h2 id="howto">How to do it</h2>
          <ol className="steps">
            {p.howTo.map((s, i) => (
              <li key={s.title}>
                <span className="n" aria-hidden="true">
                  {i + 1}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section" aria-labelledby="why">
          <h2 id="why">Why Snugclip</h2>
          <div className="why">
            <div>
              <span className="ic">
                <Icon name="ok" size={22} />
              </span>
              <h3>Never over the limit</h3>
              <p>Snugclip checks the real size of every attempt and only keeps one that fits. If a clip can&apos;t fit, it tells you the smallest size it can reach before encoding anything.</p>
            </div>
            <div>
              <span className="ic">
                <Icon name="eye" size={22} />
              </span>
              <h3>Preview before you send</h3>
              <p>Drag the before-and-after slider over the playing clips and read the plain-words quality badge, measured with SSIM on real frames.</p>
            </div>
            <div>
              <span className="ic">
                <Icon name="shield" size={22} />
              </span>
              <h3>Never uploaded</h3>
              <p>Compression runs in your browser with WebCodecs. Your video stays on your device, and the app keeps working offline after the first visit.</p>
            </div>
          </div>
        </section>

        <section className="section narrow" aria-labelledby="faq">
          <h2 id="faq">Questions</h2>
          <div className="faq">
            {p.faq.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <div className="ans">
                  {f.a.map((x) => (
                    <p key={x}>{x}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>

        <section className="section" aria-labelledby="related">
          <h2 id="related">Related</h2>
          <nav className="related" aria-labelledby="related">
            {related.map((r) => (
              <Link key={r!.slug} href={`/${r!.slug}/`}>
                {r!.navLabel}
              </Link>
            ))}
            <Link href="/">All destinations</Link>
          </nav>
        </section>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd) }} />
      </main>
      <Footer />
    </>
  );
}

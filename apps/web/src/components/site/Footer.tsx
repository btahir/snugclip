import Link from 'next/link';
import { GITHUB_URL, SUPPORT_URL } from '@/config/site';
import { KEYWORD_PAGES } from '@/content/pages';
import { t } from '@/i18n/en';
import { Logo } from './Header';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="cols">
          <div>
            <Logo height={28} />
            <p className="promise">{t.footer.promise}</p>
            <p>{t.footer.privacy}</p>
          </div>
          <div>
            <h2>{t.footer.toolPages}</h2>
            <ul className="two">
              {KEYWORD_PAGES.map((p) => (
                <li key={p.slug}>
                  <Link href={`/${p.slug}/`}>{p.navLabel}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2>{t.footer.project}</h2>
            <ul>
              <li>
                <Link href="/about/">{t.footer.about}</Link>
              </li>
              <li>
                <Link href={SUPPORT_URL}>{t.footer.support}</Link>
              </li>
              <li>
                <a href={GITHUB_URL} rel="noreferrer">
                  {t.footer.source}
                </a>
              </li>
              <li>
                <a href="/llms.txt">{t.footer.llms}</a>
              </li>
              <li>
                <Link href="/about/#credits">{t.footer.credits}</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="fine">
          <span>{t.footer.madeOnDevice}</span>
          <span>© 2026 Snugclip contributors</span>
        </div>
      </div>
    </footer>
  );
}

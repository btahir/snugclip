import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { SUPPORT_URL } from '@/config/site';
import { t } from '@/i18n/en';
import { ThemeToggle } from './ThemeToggle';

export function Logo({ height = 34 }: { height?: number }) {
  const w = Math.round((height * 174.5) / 48);
  return (
    <>
      <img className="on-light" src="/brand/logo-light.svg" alt="Snugclip" width={w} height={height} />
      <img className="on-dark" src="/brand/logo-dark.svg" alt="Snugclip" width={w} height={height} />
    </>
  );
}

export function Header({ landing = false }: { landing?: boolean }) {
  return (
    <header className="wrap site-header">
      <a className="skip" href="#tool">
        {t.nav.skip}
      </a>
      <Link className="brand" href="/" aria-label={t.nav.home}>
        <Logo />
      </Link>
      <nav className="site-nav" aria-label="Main">
        {landing ? (
          <a className="nav-link" href="#related">
            {t.nav.allTools}
          </a>
        ) : (
          <Link className="nav-link" href="/about/#how">
            {t.nav.howItWorks}
          </Link>
        )}
        <Link className="nav-link" href="/about/#privacy">
          {t.nav.privacy}
        </Link>
        <ThemeToggle />
        <Link className="support-pill" href={SUPPORT_URL}>
          <Icon name="heart" size={15} />
          {t.nav.support}
        </Link>
      </nav>
    </header>
  );
}

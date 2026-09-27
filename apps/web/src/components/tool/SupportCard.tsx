'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { SUPPORT_URL } from '@/config/site';
import { t } from '@/i18n/en';
import { useTool } from './ToolProvider';

/** The moment-of-value ask: inline, quiet, once per session, never a modal. */
export function SupportCard() {
  const { supportCard, dismissSupport } = useTool();
  if (!supportCard) return null;
  return (
    <aside className="support-card" aria-label={t.support.ask} data-testid="support-card">
      <img className="on-light" src="/brand/mark-light.svg" alt="" width={40} height={40} />
      <img className="on-dark" src="/brand/mark-dark.svg" alt="" width={40} height={40} />
      <div className="copy">
        <p>{t.support.card}</p>
        <b>{t.support.ask}</b>
      </div>
      <div className="sacts">
        <Link className="btn primary" href={SUPPORT_URL}>
          <Icon name="heart" size={16} />
          {t.support.cta}
        </Link>
        <button type="button" className="btn quiet" onClick={() => dismissSupport(false)}>
          {t.support.notNow}
        </button>
        <button type="button" className="btn quiet icon" aria-label={t.support.never} title={t.support.never} onClick={() => dismissSupport(true)}>
          <Icon name="x" />
        </button>
      </div>
    </aside>
  );
}

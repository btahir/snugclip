'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { EmptyGlass } from './FitGlass';

export function Unsupported() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="unsupported" role="region" aria-labelledby="unsupported-title" data-testid="unsupported">
      <EmptyGlass question size={72} />
      <h2 id="unsupported-title">{t.unsupported.title}</h2>
      <p>{t.unsupported.body}</p>
      <ul aria-label={t.unsupported.works}>
        {t.unsupported.list.map((x) => (
          <li key={x}>
            <Icon name="check" size={18} />
            {x}
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 'var(--sn-text-xs)', color: 'var(--sn-ink-3)' }}>{t.unsupported.cli}</p>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 18 }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
          } catch {
            /* ignore */
          }
        }}
      >
        <Icon name="link" size={18} />
        {copied ? t.unsupported.copied : t.unsupported.copyLink}
      </button>
    </div>
  );
}

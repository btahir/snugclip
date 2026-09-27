'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { EmptyGlass } from './FitGlass';
import { useTool } from './ToolProvider';

/** Why the tool can't run, from the worker's feature detection (see ToolProvider / worker init). */
function bodyFor(reason: string | undefined): string {
  if (!reason || reason === 'no-webcodecs') return t.unsupported.body;
  if (reason === 'no-encoder') return t.unsupported.bodyNoEncoder;
  return t.unsupported.bodyEngineFailed;
}

export function Unsupported() {
  const { supportReason } = useTool();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  return (
    <div className="unsupported" role="region" aria-labelledby="unsupported-title" data-testid="unsupported">
      <EmptyGlass question size={72} />
      <h2 id="unsupported-title">{t.unsupported.title}</h2>
      <p>{bodyFor(supportReason)}</p>
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
            // No async clipboard (older browsers, blocked permission): show the link to copy by hand.
            setManual(window.location.href);
          }
        }}
      >
        <Icon name="link" size={18} />
        {copied ? t.unsupported.copied : t.unsupported.copyLink}
      </button>
      {manual && (
        <p className="mono" style={{ marginTop: 12, fontSize: 'var(--sn-text-xs)', userSelect: 'all', wordBreak: 'break-all' }}>
          {manual}
        </p>
      )}
    </div>
  );
}

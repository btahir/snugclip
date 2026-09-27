'use client';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { summarize } from '@/lib/tool-model';
import { QueueItem } from './QueueItem';
import { useTool } from './ToolProvider';

export function Queue() {
  const { state, downloadAll, exportReport } = useTool();
  const s = summarize(state.items);
  if (!s.total) return null;
  const parts = [s.ready && t.queue.ready(s.ready), s.running && t.queue.compressing(s.running), s.waiting && t.queue.waiting(s.waiting), s.attention && t.queue.needsAttention(s.attention)].filter(Boolean) as string[];
  const firstQueued = state.items.find((i) => i.status === 'queued')?.id;
  const hasReports = state.items.some((i) => i.report);
  return (
    <section aria-labelledby="queue-title">
      <div className="qbar">
        <div>
          <h2 id="queue-title">{t.queue.count(s.total)}</h2>
          <p>{parts.join(' · ')}</p>
        </div>
        <span className="sp" />
        <div className="acts">
          {hasReports && (
            <button type="button" className="btn quiet desk" onClick={exportReport}>
              <Icon name="doc" size={18} />
              {t.queue.exportReport}
            </button>
          )}
          <button type="button" className="btn" disabled={s.ready < 2} onClick={() => void downloadAll()} data-testid="download-all">
            <Icon name="down" size={18} />
            {s.ready >= 2 ? t.queue.downloadAllZip : t.queue.downloadAll}
          </button>
        </div>
      </div>
      <ul className="queue" aria-label={t.queue.region}>
        {state.items.map((it) => (
          <li key={it.id}>
            <QueueItem it={it} isNext={it.id === firstQueued && s.running > 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}

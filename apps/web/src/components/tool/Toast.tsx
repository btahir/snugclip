'use client';
import { t } from '@/i18n/en';
import { useTool } from './ToolProvider';

export function ToastAndLive() {
  const { toast, announcement } = useTool();
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" aria-label={t.a11y.live} data-testid="live">
        {announcement}
      </div>
      <div role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className="toast">
            {toast.text}
          </div>
        )}
      </div>
    </>
  );
}

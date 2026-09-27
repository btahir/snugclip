'use client';
import { Icon } from '@/components/Icon';

/** Closing call to action on landing pages: scrolls back to the tool and opens the file picker. */
export function CtaBand({ title, button }: { title: string; button: string }) {
  return (
    <section className="cta-band" aria-label={title}>
      <p className="cta-title">{title}</p>
      <button
        type="button"
        className="btn primary lg"
        onClick={() => {
          document.getElementById('tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.querySelector<HTMLInputElement>('[data-testid="file-input"]')?.click();
        }}
      >
        <Icon name="plus" size={20} />
        {button}
      </button>
    </section>
  );
}

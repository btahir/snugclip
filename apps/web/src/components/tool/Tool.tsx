'use client';
// The tool: target bar → options → drop / queue → support card. Used by the home page and
// every keyword page (each passes its own preselected target).
import type { Target } from '@snugclip/core';
import { useCallback, useState } from 'react';
import { DropCard, DropStrip, Trust, useGlobalDrop } from './DropZone';
import { OptionsDrawer } from './OptionsDrawer';
import { Queue } from './Queue';
import { SupportCard } from './SupportCard';
import { TargetBar } from './TargetBar';
import { ToastAndLive } from './Toast';
import { ToolProvider, useTool } from './ToolProvider';
import { Unsupported } from './Unsupported';
import { t } from '@/i18n/en';

function ToolInner({ hero }: { hero?: boolean }) {
  const { state, support } = useTool();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const over = useGlobalDrop();
  const close = useCallback(() => setOptionsOpen(false), []);
  const optsBtn = useCallback(() => document.querySelector<HTMLElement>('.optsbtn'), []);
  return (
    <div id="tool" className="tool" data-support={support}>
      {hero && (
        <div className={state.items.length ? 'sr-only' : 'home-hero'}>
          <h1>
            {t.home.h1a} <em>{t.home.h1b}</em>
          </h1>
          <p>{t.home.lede}</p>
        </div>
      )}
      <TargetBar optionsOpen={optionsOpen} onToggleOptions={() => setOptionsOpen((o) => !o)} />
      {optionsOpen && <OptionsDrawer onClose={close} returnFocusTo={optsBtn} />}
      {support === 'unsupported' ? (
        <Unsupported />
      ) : state.items.length === 0 ? (
        <DropCard over={over} />
      ) : (
        <>
          <Queue />
          <DropStrip over={over} />
        </>
      )}
      <SupportCard />
      <Trust />
      {over !== false && <div className="drag-overlay" aria-hidden="true" />}
      <ToastAndLive />
    </div>
  );
}

export function Tool({ initialTarget, hero }: { initialTarget?: Target; hero?: boolean }) {
  return (
    <ToolProvider {...(initialTarget ? { initialTarget } : {})}>
      <ToolInner {...(hero ? { hero } : {})} />
    </ToolProvider>
  );
}

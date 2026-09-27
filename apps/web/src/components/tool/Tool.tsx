'use client';
// The tool: target bar → options → drop / queue → support card. Used by the home page and
// every keyword page (each passes its own preselected target).
import type { Target } from '@snugclip/core';
import { useCallback, useState } from 'react';
import { DropCard, DropStrip, Trust, useGlobalDrop } from './DropZone';
import { OptionsDrawer } from './OptionsDrawer';
import { Queue } from './Queue';
import { SupportCard } from './SupportCard';
import { TargetBar, TierBar } from './TargetBar';
import { ToastAndLive } from './Toast';
import { ToolProvider, useTool } from './ToolProvider';
import { Unsupported } from './Unsupported';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { HeroGlass } from '@/components/site/HeroGlass';
import { limitText } from '@/lib/format';

function ToolInner({ hero, tiers }: { hero?: boolean; tiers?: boolean }) {
  const { state, support, audioLimited } = useTool();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const over = useGlobalDrop();
  const close = useCallback(() => setOptionsOpen(false), []);
  const optsBtn = useCallback(() => document.querySelector<HTMLElement>('.optsbtn'), []);
  return (
    <div id="tool" className="tool" data-support={support}>
      {hero && (
        <div className={state.items.length ? 'sr-only' : 'home-hero'}>
          <div>
            <h1>
              {t.home.h1a} <em>{t.home.h1b}</em>
            </h1>
            <p>{t.home.lede}</p>
          </div>
          {!state.items.length && (
            <div className="hero-glass" aria-hidden="true">
              <HeroGlass key={state.target.bytes} label={limitText(state.target.bytes)} small />
            </div>
          )}
        </div>
      )}
      <div aria-disabled={support === 'unsupported' || undefined} inert={support === 'unsupported' || undefined}>
        <TargetBar optionsOpen={optionsOpen} onToggleOptions={() => setOptionsOpen((o) => !o)} />
      </div>
      {tiers && <TierBar />}
      {audioLimited && (
        <p className="notice info compat-note" role="note" data-testid="audio-limited">
          <Icon name="info" size={18} />
          <span>{t.unsupported.audioLimited}</span>
        </p>
      )}
      {optionsOpen && <OptionsDrawer onClose={close} returnFocusTo={optsBtn} />}
      {support === 'unsupported' ? (
        <Unsupported />
      ) : state.items.length === 0 ? (
        <DropCard over={over} compactIcon={!!hero || !!tiers} />
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

export function Tool({ initialTarget, hero, tiers }: { initialTarget?: Target; hero?: boolean; tiers?: boolean }) {
  return (
    <ToolProvider {...(initialTarget ? { initialTarget } : {})}>
      <ToolInner {...(hero ? { hero } : {})} {...(tiers ? { tiers } : {})} />
    </ToolProvider>
  );
}

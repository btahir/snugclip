'use client';
import { MB, type Target } from '@snugclip/core';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import {
  checkedLabel,
  destinationForTarget,
  isValidCustomBytes,
  resolveDestinations,
  targetFromPreset,
  type ResolvedDestination,
} from '@/lib/destinations';
import { limitText } from '@/lib/format';
import { useTool } from './ToolProvider';

type Pop = { key: string; left: number } | null;

export function optionsSummary(o: { codec: string; mute: boolean; keepFps: boolean; maxShortSide?: number }, container = 'MP4'): string {
  const parts = [o.codec === 'compatible' || o.codec === 'h264' ? container : o.codec === 'vp9' ? 'WebM' : `${container} · smaller`];
  parts.push(o.mute ? t.options.summaryMuted : t.options.summarySound);
  parts.push(o.maxShortSide ? t.options.summaryMax(o.maxShortSide) : t.options.summaryAutoSize);
  if (o.keepFps) parts.push(t.options.summaryKeepFps);
  return t.target.optionsSummary(parts);
}

export function TargetBar({ optionsOpen, onToggleOptions }: { optionsOpen: boolean; onToggleOptions: () => void }) {
  const { state, setTarget } = useTool();
  const dests = useMemo(() => resolveDestinations(), []);
  const selectedKey = destinationForTarget(state.target, dests);
  const [pop, setPop] = useState<Pop>(null);
  const [lastTier, setLastTier] = useState<Record<string, string>>({});
  const barRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const [atEnd, setAtEnd] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const keys = [...dests.map((d) => d.key), 'custom'];
  const [focusKey, setFocusKey] = useState(selectedKey);
  useEffect(() => setFocusKey(selectedKey), [selectedKey]);

  // Keep the selected chip in view (e.g. after a deep link or remembered target).
  useEffect(() => {
    const el = chipRefs.current.get(selectedKey);
    const row = chipsRef.current;
    if (!el || !row) return;
    if (el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth || el.offsetLeft < row.scrollLeft) {
      row.scrollTo({ left: Math.max(0, el.offsetLeft - 16) });
    }
  }, [selectedKey]);

  useEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const onScroll = () => {
      setAtEnd(row.scrollLeft + row.clientWidth >= row.scrollWidth - 4);
      setAtStart(row.scrollLeft <= 4);
    };
    onScroll();
    row.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      row.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setPop(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        const k = pop.key;
        setPop(null);
        chipRefs.current.get(k)?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pop]);

  const openPop = (key: string) => {
    const el = chipRefs.current.get(key);
    const bar = barRef.current;
    if (!el || !bar) return;
    const r = el.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    setPop({ key, left: Math.max(8, Math.min(r.left - b.left, b.width - 300)) });
  };

  const choose = (d: ResolvedDestination) => {
    const tierId = lastTier[d.key];
    const tier = d.tiers.find((x) => x.preset.id === tierId) ?? d.tiers[0]!;
    const already = selectedKey === d.key;
    if (!already || state.target.presetId !== tier.preset.id) setTarget(targetFromPreset(tier.preset));
    if (d.tiers.length > 1 || d.kind === 'platform') {
      if (pop?.key === d.key) setPop(null);
      else openPop(d.key);
    } else setPop(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = keys.indexOf(focusKey);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % keys.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + keys.length) % keys.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = keys.length - 1;
    if (n >= 0) {
      e.preventDefault();
      const k = keys[n]!;
      setFocusKey(k);
      chipRefs.current.get(k)?.focus();
      chipRefs.current.get(k)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  };

  const limit = limitText(state.target.bytes);
  const popDest = pop && pop.key !== 'custom' ? dests.find((d) => d.key === pop.key) : null;

  return (
    <section className="target" ref={barRef} aria-label={t.target.region}>
      <div className="target-q">
        <small>{t.target.sendingTo}</small>
        <b data-testid="must-fit">{t.target.mustFit(limit)}</b>
        <span className="summary">{optionsSummary(state.options)}</span>
      </div>
      <div
        ref={chipsRef}
        className={`chips${atEnd ? ' at-end' : ''}${atStart ? ' at-start' : ''}`}
        role="radiogroup"
        aria-label={t.target.destinations}
        onKeyDown={onKeyDown}
      >
        {dests.map((d) => {
          const checked = selectedKey === d.key;
          const shownTier = checked ? d.tiers.find((x) => x.preset.id === state.target.presetId) ?? d.tiers[0]! : d.tiers.find((x) => x.preset.id === lastTier[d.key]) ?? d.tiers[0]!;
          const size = limitText(shownTier.preset.bytes);
          return (
            <button
              key={d.key}
              ref={(el) => {
                if (el) chipRefs.current.set(d.key, el);
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={t.target.chipAria(d.kind === 'size' ? d.name : `${d.name}${d.tiers.length > 1 ? ` ${shownTier.label}` : ''}`, size)}
              tabIndex={focusKey === d.key ? 0 : -1}
              className="chip"
              data-dest={d.key}
              onClick={() => choose(d)}
              onFocus={() => setFocusKey(d.key)}
            >
              <span className="gl">
                <Icon name={d.glyph} size={21} />
              </span>
              <span className="lbl">
                {d.name}
                <small>{d.kind === 'size' ? `${shownTier.preset.bytes.toLocaleString('en-US')} B` : size}</small>
              </span>
            </button>
          );
        })}
        <button
          ref={(el) => {
            if (el) chipRefs.current.set('custom', el);
          }}
          type="button"
          role="radio"
          aria-checked={selectedKey === 'custom'}
          aria-label={t.target.chipAria(t.target.custom, selectedKey === 'custom' ? limit : t.target.anySize)}
          tabIndex={focusKey === 'custom' ? 0 : -1}
          className="chip custom"
          data-dest="custom"
          onClick={() => (pop?.key === 'custom' ? setPop(null) : openPop('custom'))}
          onFocus={() => setFocusKey('custom')}
        >
          <span className="gl">
            <Icon name="custom" size={21} />
          </span>
          <span className="lbl">
            {t.target.custom}
            <small>{selectedKey === 'custom' ? limit : t.target.anySize}</small>
          </span>
        </button>
      </div>
      <button type="button" className="optsbtn" aria-expanded={optionsOpen} aria-controls="options-drawer" onClick={onToggleOptions}>
        <Icon name="sliders" size={18} />
        {t.target.options}
        {(state.options.codec !== 'compatible' || state.options.mute || state.options.keepFps || state.options.maxShortSide || state.options.reencode) && <span className="dot" aria-hidden="true" />}
      </button>

      <button type="button" className="opts-phone phone-only" aria-expanded={optionsOpen} aria-controls="options-drawer" onClick={onToggleOptions}>
        <Icon name="sliders" size={16} />
        <span>{t.target.options}</span>
        <span className="mono">{optionsSummary(state.options)}</span>
      </button>

      {popDest && (
        <div className="popover" style={{ left: pop!.left, top: 'calc(100% + 8px)' }} role="group" aria-label={t.target.tiers(popDest.name)}>
          {popDest.tiers.length > 1 && (
            <>
              <h3>{t.target.tiers(popDest.name)}</h3>
              <div className="seg" role="radiogroup" aria-label={t.target.tiers(popDest.name)}>
                {popDest.tiers.map((tier) => (
                  <button
                    key={tier.preset.id}
                    type="button"
                    role="radio"
                    aria-checked={state.target.presetId === tier.preset.id}
                    onClick={() => {
                      setLastTier((m) => ({ ...m, [popDest.key]: tier.preset.id }));
                      setTarget(targetFromPreset(tier.preset));
                    }}
                  >
                    {tier.label}
                    <small>{limitText(tier.preset.bytes)}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          <TierSource dest={popDest} presetId={state.target.presetId} />
        </div>
      )}
      {pop?.key === 'custom' && (
        <CustomPopover
          left={pop.left}
          current={selectedKey === 'custom' ? state.target : null}
          onSet={(bytes) => {
            setTarget({ bytes, label: limitText(bytes) });
            setPop(null);
            chipRefs.current.get('custom')?.focus();
          }}
        />
      )}
    </section>
  );
}

function TierSource({ dest, presetId }: { dest: ResolvedDestination; presetId?: string }) {
  const tier = dest.tiers.find((x) => x.preset.id === presetId) ?? dest.tiers[0]!;
  const p = tier.preset;
  const official = !/community|not officially/i.test(p.statedLimit);
  return (
    <p className="src">
      {p.note}{' '}
      <span>
        (
        <a href={p.sourceUrl} target="_blank" rel="noreferrer">
          {t.target.source}
        </a>
        {official ? `, ${t.target.checked(checkedLabel(p.checked) ?? '')}` : `, ${t.target.notOfficial}`})
      </span>
    </p>
  );
}

function CustomPopover({ left, current, onSet }: { left: number; current: Target | null; onSet: (bytes: number) => void }) {
  const [unit, setUnit] = useState<'MB' | 'GB'>(current && current.bytes >= 1e9 && current.bytes % 1e9 === 0 ? 'GB' : 'MB');
  const [value, setValue] = useState(current ? String(unit === 'GB' ? current.bytes / 1e9 : current.bytes / MB) : '');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const n = Number(value);
  const bytes = Math.round(n * (unit === 'GB' ? 1e9 : MB));
  const valid = value.trim() !== '' && Number.isFinite(n) && isValidCustomBytes(bytes);
  return (
    <div className="popover" style={{ left, top: 'calc(100% + 8px)' }} role="group" aria-label={t.target.customLabel}>
      <h3 id="custom-label">{t.target.customLabel}</h3>
      <form
        className="custom-field"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSet(bytes);
        }}
      >
        <input
          ref={inputRef}
          inputMode="decimal"
          aria-labelledby="custom-label"
          aria-invalid={value !== '' && !valid}
          aria-describedby="custom-hint"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(',', '.'))}
          placeholder="10"
        />
        <div className="seg" role="radiogroup" aria-label={t.target.customUnit}>
          {(['MB', 'GB'] as const).map((u) => (
            <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => setUnit(u)}>
              {u}
            </button>
          ))}
        </div>
        <button type="submit" className="btn primary" disabled={!valid}>
          {t.target.customApply}
        </button>
      </form>
      <p id="custom-hint" className={`hint${value !== '' && !valid ? ' bad' : ''}`}>
        {value !== '' && !valid ? t.target.customInvalid : t.target.customHint}
      </p>
    </div>
  );
}

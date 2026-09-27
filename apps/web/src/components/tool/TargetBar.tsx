'use client';
import { MB, type Target } from '@snugclip/core';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

export function optionsSummary(o: { codec: string; mute: boolean; keepFps: boolean; maxShortSide?: number }): string {
  // Only what differs from the defaults (at most two items), so the summary never truncates.
  const parts: string[] = [];
  if (o.codec !== 'compatible' && o.codec !== 'h264') parts.push(o.codec === 'vp9' ? 'WebM' : 'smaller');
  if (o.mute) parts.push(t.options.summaryMuted);
  if (o.maxShortSide) parts.push(t.options.summaryMax(o.maxShortSide));
  if (o.keepFps) parts.push(t.options.summaryKeepFps);
  if (!parts.length) return t.options.summaryDefault;
  return t.target.optionsSummary(parts.length > 2 ? [...parts.slice(0, 2), `+${parts.length - 2}`] : parts);
}

/** Tier segmented control for the selected platform, shown inline under the bar on landing pages. */
export function TierBar() {
  const { state, setTarget } = useTool();
  const dests = useMemo(() => resolveDestinations(), []);
  const key = destinationForTarget(state.target, dests, lastActiveDest.current);
  const dest = dests.find((d) => d.key === key);
  if (!dest || dest.tiers.length < 2) return null;
  return (
    <div className="tierbar">
      <span className="tierbar-label" id="tierbar-label">
        {t.target.tiers(dest.name)}
      </span>
      <div className="seg" role="radiogroup" aria-labelledby="tierbar-label">
        {dest.tiers.map((tier) => (
          <button
            key={tier.preset.id}
            type="button"
            role="radio"
            aria-checked={state.target.presetId === tier.preset.id}
            onClick={() => {
              rememberDest(dest.key);
              setTarget(targetFromPreset(tier.preset));
            }}
          >
            {tier.label}
            <small>{limitText(tier.preset.bytes)}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Which platform chip the person last chose a tier from (keeps "Discord · older free 10 MB" on Discord). */
const lastActiveDest: { current: string | null } = { current: null };
function rememberDest(k: string): void {
  lastActiveDest.current = k;
}

export function TargetBar({ optionsOpen, onToggleOptions }: { optionsOpen: boolean; onToggleOptions: () => void }) {
  const { state, setTarget } = useTool();
  const dests = useMemo(() => resolveDestinations(), []);
  const [activeDest, setActiveDest] = useState<string | null>(null);
  const selectedKey = destinationForTarget(state.target, dests, activeDest ?? lastActiveDest.current);
  const [pop, setPop] = useState<Pop>(null);
  const [lastTier, setLastTier] = useState<Record<string, string>>({});
  const barRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const [edges, setEdges] = useState({ start: true, end: false });
  const platform = dests.filter((d) => d.kind === 'platform');
  const sizes = dests.filter((d) => d.kind === 'size');
  const keys = [...platform.map((d) => d.key), ...sizes.map((d) => d.key), 'custom'];
  const [focusKey, setFocusKey] = useState(selectedKey);
  useEffect(() => setFocusKey(selectedKey), [selectedKey]);

  // B1: keep the selected chip fully in view, centred in the row (after fonts load and on resize).
  const reveal = useCallback(() => {
    const el = chipRefs.current.get(selectedKey);
    const row = chipsRef.current;
    if (!el || !row || !row.contains(el)) return;
    const left = el.offsetLeft - row.offsetLeft;
    const inView = left >= row.scrollLeft + 28 && left + el.offsetWidth <= row.scrollLeft + row.clientWidth - 28;
    if (!inView) row.scrollLeft = Math.max(0, left - (row.clientWidth - el.offsetWidth) / 2);
  }, [selectedKey]);
  useEffect(() => {
    reveal();
    let alive = true;
    void document.fonts?.ready.then(() => alive && reveal());
    window.addEventListener('resize', reveal);
    return () => {
      alive = false;
      window.removeEventListener('resize', reveal);
    };
  }, [reveal]);

  useEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const onScroll = () => setEdges({ start: row.scrollLeft <= 4, end: row.scrollLeft + row.clientWidth >= row.scrollWidth - 4 });
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
    setActiveDest(d.key);
    rememberDest(d.key);
    if (selectedKey !== d.key || state.target.presetId !== tier.preset.id) setTarget(targetFromPreset(tier.preset));
    if (d.kind === 'platform') {
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

  const scrollBy = (dir: 1 | -1) => {
    const row = chipsRef.current;
    if (row) row.scrollBy({ left: dir * row.clientWidth * 0.7, behavior: 'smooth' });
  };

  const limit = limitText(state.target.bytes);
  const popDest = pop && pop.key !== 'custom' ? dests.find((d) => d.key === pop.key) : null;
  const refChip = (k: string) => (el: HTMLButtonElement | null) => {
    if (el) chipRefs.current.set(k, el);
  };

  const platformChip = (d: ResolvedDestination) => {
    const checked = selectedKey === d.key;
    const shownTier = checked ? (d.tiers.find((x) => x.preset.id === state.target.presetId) ?? d.tiers[0]!) : (d.tiers.find((x) => x.preset.id === lastTier[d.key]) ?? d.tiers[0]!);
    const size = limitText(shownTier.preset.bytes);
    return (
      <button
        key={d.key}
        ref={refChip(d.key)}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={t.target.chipAria(`${d.name}${d.tiers.length > 1 ? ` ${shownTier.label}` : ''}`, size)}
        tabIndex={focusKey === d.key || (focusKey === 'custom' && d.key === platform[0]?.key) ? 0 : -1}
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
          <small>{size}</small>
        </span>
        {d.tiers.length > 1 && <Icon name="chevron" size={12} className="caret" />}
      </button>
    );
  };

  return (
    <section className="target" ref={barRef} aria-label={t.target.region}>
      <div className="target-q">
        <span className="limit-bar" aria-hidden="true" />
        <b data-testid="must-fit" aria-label={t.target.mustFit(limit)}>
          {t.target.fitsUnder} <span className="lim">{limit}</span>
        </b>
      </div>
      <div className="chips-wrap">
        {!edges.start && (
          <button type="button" className="chip-scroll left" aria-label={t.target.scrollLeft} tabIndex={-1} onClick={() => scrollBy(-1)}>
            <Icon name="chevronRight" size={18} className="flip-x" />
          </button>
        )}
        <div
          ref={chipsRef}
          className={`chips${edges.end ? ' at-end' : ''}${edges.start ? ' at-start' : ''}`}
          role="radiogroup"
          aria-label={t.target.destinations}
          aria-owns="chip-custom"
          onKeyDown={onKeyDown}
        >
          {platform.map(platformChip)}
          <span className="chip-divider" aria-hidden="true" />
          {sizes.map((d) => {
            const checked = selectedKey === d.key;
            const p = d.tiers[0]!.preset;
            return (
              <button
                key={d.key}
                ref={refChip(d.key)}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={t.target.chipAria(d.name, `${p.bytes.toLocaleString('en-US')} bytes`)}
                tabIndex={focusKey === d.key ? 0 : -1}
                className="chip size"
                data-dest={d.key}
                onClick={() => choose(d)}
                onFocus={() => setFocusKey(d.key)}
              >
                {d.name}
              </button>
            );
          })}
        </div>
        {!edges.end && (
          <button type="button" className="chip-scroll right" aria-label={t.target.scrollRight} tabIndex={-1} onClick={() => scrollBy(1)}>
            <Icon name="chevronRight" size={18} />
          </button>
        )}
      </div>
      <div className="target-end">
        <button
          id="chip-custom"
          ref={refChip('custom')}
          type="button"
          role="radio"
          aria-checked={selectedKey === 'custom'}
          aria-label={t.target.chipAria(t.target.custom, selectedKey === 'custom' ? limit : t.target.anySize)}
          tabIndex={focusKey === 'custom' ? 0 : -1}
          className="chip custom"
          data-dest="custom"
          onKeyDown={onKeyDown as never}
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
        <button type="button" className="optsbtn" aria-expanded={optionsOpen} aria-controls="options-drawer" onClick={onToggleOptions}>
          <Icon name="sliders" size={18} />
          <span className="lbl">
            {t.target.options}
            <small>{optionsSummary(state.options)}</small>
          </span>
        </button>
      </div>

      {popDest && (
        <div className="popover" style={{ left: pop!.left, top: 'calc(100% + 8px)' }} role="group" aria-label={t.target.tiers(popDest.name)}>
          {popDest.tiers.length > 1 && (
            <>
              <h3>{t.target.tiers(popDest.name)}</h3>
              <div className="seg col-phone" role="radiogroup" aria-label={t.target.tiers(popDest.name)}>
                {popDest.tiers.map((tier) => (
                  <button
                    key={tier.preset.id}
                    type="button"
                    role="radio"
                    aria-checked={state.target.presetId === tier.preset.id}
                    onClick={() => {
                      setLastTier((m) => ({ ...m, [popDest.key]: tier.preset.id }));
                      setActiveDest(popDest.key);
                      rememberDest(popDest.key);
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
    <div className="popover custom-pop" style={{ left, top: 'calc(100% + 8px)' }} role="group" aria-label={t.target.customLabel}>
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

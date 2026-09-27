'use client';
import { formatDuration, formatSize } from '@snugclip/core';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '@/i18n/en';
import { clockTenths } from '@/lib/format';
import { coreOptions, previewPlan, type Item } from '@/lib/tool-model';
import { MiniGlass } from './FitGlass';
import { useTool } from './ToolProvider';

const FRAMES = 12;
const MIN_LEN = 0.5;

export function TrimTimeline({ it }: { it: Item }) {
  const tool = useTool();
  const D = it.probe?.durationSec ?? 0;
  const [range, setRange] = useState<[number, number]>(() => [it.trim?.startSec ?? 0, Math.min(D, it.trim?.endSec ?? D)]);
  const [frames, setFrames] = useState<(string | null)[]>([]);
  const filmRef = useRef<HTMLDivElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const startRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let urls: string[] = [];
    let alive = true;
    const times = Array.from({ length: FRAMES }, (_, i) => (D * (i + 0.5)) / FRAMES);
    tool.thumbs(it.file, times, 96).then((blobs) => {
      if (!alive) return;
      const list = blobs.map((b) => (b ? URL.createObjectURL(b) : null));
      urls = list.filter((u): u is string => !!u);
      setFrames(list);
    });
    startRef.current?.focus();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.file, D]);

  const [a, b] = range;
  const full = a <= 0.001 && b >= D - 0.001;
  const pv = useMemo(() => {
    if (!it.probe || !tool.caps) return null;
    const trim = full ? undefined : { startSec: a, endSec: b };
    return previewPlan(it.probe, tool.state.target, coreOptions(tool.state.options, trim, it.overrides), tool.caps);
  }, [a, b, full, it.probe, it.overrides, tool.caps, tool.state.target, tool.state.options]);

  const pct = (x: number) => (D > 0 ? (x / D) * 100 : 0);
  const fromClient = (clientX: number) => {
    const r = filmRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(D, ((clientX - r.left) / r.width) * D));
  };
  const setHandle = (h: 0 | 1, v: number) => {
    setRange(([s, e]) => (h === 0 ? [Math.max(0, Math.min(v, e - MIN_LEN)), e] : [s, Math.min(D, Math.max(v, s + MIN_LEN))]));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const v = fromClient(e.clientX);
    const h = (e.target as HTMLElement).dataset.h;
    drag.current = h === '0' ? 0 : h === '1' ? 1 : Math.abs(v - a) < Math.abs(v - b) ? 0 : 1;
    e.currentTarget.setPointerCapture(e.pointerId);
    setHandle(drag.current, v);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== null) setHandle(drag.current, fromClient(e.clientX));
  };
  const onKey = (h: 0 | 1) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.1;
    const cur = h === 0 ? a : b;
    let v: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = cur - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = cur + step;
    else if (e.key === 'Home') v = h === 0 ? 0 : a + MIN_LEN;
    else if (e.key === 'End') v = h === 0 ? b - MIN_LEN : D;
    if (v === null) return;
    e.preventDefault();
    setHandle(h, v);
  };

  const refused = it.status === 'impossible';
  let hint: React.ReactNode = null;
  if (pv) {
    if (!pv.feasible) hint = <span className="fit warn">{t.trimmer.stillTooBig(formatSize(pv.minimumBytes, { round: 'ceil' }))}</span>;
    else if (refused) hint = <span className="fit ok">{t.trimmer.nowFits}</span>;
    else hint = <span className={`fit${refused ? ' ok' : ''}`}>{t.trimmer.fitsAt(pv.height && pv.width ? `${Math.min(pv.width, pv.height)}p` : '—', formatSize(pv.projectedBytes, { round: 'nearest' }))}</span>;
  }

  return (
    <div className="trim" role="group" aria-label={t.trimmer.region(it.name)}>
      <div className="trim-hint">
        <MiniGlass target={tool.state.target.bytes} bytes={pv?.feasible ? pv.projectedBytes : 0} state={pv && !pv.feasible ? 'warn' : 'done'} />
        {hint}
        <span className="times">{t.trimmer.range(clockTenths(a), clockTenths(b), formatDuration(b - a))}</span>
      </div>
      <div ref={filmRef} className="film" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <div className="frames" aria-hidden="true">
          {(frames.length ? frames : Array.from({ length: FRAMES }, () => null)).map((f, i) => (f ? <img key={i} src={f} alt="" draggable={false} /> : <span key={i} className="shimmer" />))}
        </div>
        <div className="dim" style={{ left: 0, width: `${pct(a)}%` }} />
        <div className="dim" style={{ left: `${pct(b)}%`, right: 0 }} />
        <div className="sel" style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />
        <div
          ref={startRef}
          className="handle"
          data-h="0"
          style={{ left: `max(16px, ${pct(a)}%)`, transform: 'translateX(-100%)', borderRadius: '8px 3px 3px 8px' }}
          role="slider"
          tabIndex={0}
          aria-label={t.trimmer.startHandle}
          aria-valuemin={0}
          aria-valuemax={Math.round(D * 10) / 10}
          aria-valuenow={Math.round(a * 10) / 10}
          aria-valuetext={clockTenths(a)}
          onKeyDown={onKey(0)}
        />
        <div
          className="handle"
          data-h="1"
          style={{ left: `min(calc(100% - 16px), ${pct(b)}%)`, transform: 'none', borderRadius: '3px 8px 8px 3px' }}
          role="slider"
          tabIndex={0}
          aria-label={t.trimmer.endHandle}
          aria-valuemin={0}
          aria-valuemax={Math.round(D * 10) / 10}
          aria-valuenow={Math.round(b * 10) / 10}
          aria-valuetext={clockTenths(b)}
          onKeyDown={onKey(1)}
        />
      </div>
      <div className="trim-acts">
        <button type="button" className="btn quiet" onClick={() => tool.openTrim(null)}>
          {t.trimmer.cancel}
        </button>
        <button type="button" className="btn" onClick={() => setRange([0, D])} disabled={full}>
          {t.trimmer.reset}
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            tool.setTrim(it.id, full ? undefined : { startSec: Math.round(a * 1000) / 1000, endSec: Math.round(b * 1000) / 1000 });
            tool.openTrim(null);
          }}
        >
          {t.trimmer.done}
        </button>
      </div>
    </div>
  );
}

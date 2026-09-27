'use client';
import { formatSize } from '@snugclip/core';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { clock } from '@/lib/format';
import { lsGet, lsSet } from '@/lib/storage';
import type { Item } from '@/lib/tool-model';

const MODE_KEY = 'snugclip-compare-mode';

export function Compare({ it }: { it: Item }) {
  const r = it.report!;
  const pass = r.passThrough;
  const trimStart = r.plan?.trim?.startSec ?? it.trim?.startSec ?? 0;
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [split, setSplit] = useState(50);
  const [mode, setMode] = useState<'split' | 'flip'>('split');
  const [showAfter, setShowAfter] = useState(true);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(r.output?.durationSec ?? 0);
  const [srcBroken, setSrcBroken] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (pass) return;
    const u = URL.createObjectURL(it.file);
    setSrcUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [it.file, pass]);

  useEffect(() => {
    if (lsGet(MODE_KEY) === 'flip') setMode('flip');
  }, []);

  // Keep the original in lock-step with the compressed clip (the master).
  useEffect(() => {
    const a = afterRef.current;
    const b = beforeRef.current;
    if (!a) return;
    let raf = 0;
    const sync = () => {
      setTime(a.currentTime);
      if (b && !srcBroken) {
        const want = a.currentTime + trimStart;
        if (Math.abs(b.currentTime - want) > 0.12) b.currentTime = want;
        if (!a.paused && b.paused) void b.play().catch(() => {});
        if (a.paused && !b.paused) b.pause();
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [srcBroken, trimStart, srcUrl]);

  const togglePlay = () => {
    const a = afterRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().catch(() => {});
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seek = (v: number) => {
    const a = afterRef.current;
    if (!a) return;
    a.currentTime = v;
    if (beforeRef.current && !srcBroken) beforeRef.current.currentTime = v + trimStart;
    setTime(v);
  };

  const setFromPointer = useCallback((clientX: number) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ctools')) return;
    if (mode === 'flip') {
      setShowAfter((s) => !s);
      return;
    }
    dragging.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setFromPointer(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && mode === 'split') setFromPointer(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const onKnobKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setSplit((s) => Math.max(0, s - step));
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setSplit((s) => Math.min(100, s + step));
    else if (e.key === 'Home') setSplit(0);
    else if (e.key === 'End') setSplit(100);
    else return;
    e.preventDefault();
  };

  const onDouble = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setZoom((z) => (z ? null : { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }));
  };

  const effectiveSplit = pass || srcBroken ? 0 : split;
  const style = {
    '--split': `${effectiveSplit}%`,
    '--flip-after': showAfter ? 1 : 0,
    '--zx': `${zoom?.x ?? 50}%`,
    '--zy': `${zoom?.y ?? 50}%`,
  } as CSSProperties;
  const beforeSize = formatSize(it.bytes, { round: 'nearest' });
  const afterSize = formatSize(r.output?.bytes ?? it.bytes);

  return (
    <>
      <div
        ref={boxRef}
        className={`compare${mode === 'flip' ? ' flip' : ''}${zoom ? ' zoomed' : ''}`}
        style={style}
        role="group"
        aria-label={t.review.compare}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDouble}
        data-testid="compare"
      >
        <div className="zoomer">
          {srcUrl && !srcBroken && (
            <video ref={beforeRef} src={srcUrl} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} onError={() => setSrcBroken(true)} />
          )}
          <div className="after">
            <video
              ref={afterRef}
              src={it.outputUrl}
              muted
              playsInline
              preload="metadata"
              aria-label={`${t.review.snug} ${afterSize}`}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration;
                if (Number.isFinite(d) && d > 0) setDur(d);
                e.currentTarget.currentTime = Math.min(0.05, d || 0);
              }}
              onEnded={() => setPlaying(false)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
          </div>
        </div>
        {!pass && !srcBroken && mode === 'split' && (
          <>
            <div className="bar" />
            <div
              className="knob"
              role="slider"
              tabIndex={0}
              aria-label={t.review.sliderLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              aria-valuetext={t.review.sliderValue(Math.round(split))}
              onKeyDown={onKnobKey}
            >
              <Icon name="lr" size={22} />
            </div>
          </>
        )}
        {!pass && !srcBroken && (mode === 'split' || !showAfter) && (
          <span className="clbl l">
            {t.review.original}
            <span>{beforeSize}</span>
          </span>
        )}
        {(pass || srcBroken || mode === 'split' || showAfter) && (
          <span className="clbl r">
            {pass ? t.review.original : t.review.snug}
            <span>{afterSize}</span>
          </span>
        )}
        {mode === 'flip' && !pass && <span className="flipnote">{t.review.flipHint}</span>}
        {srcBroken && <span className="cantplay">{t.review.originalCantPlay}</span>}
        <div className="ctools">
          <button type="button" className="ctool" aria-pressed={!!zoom} aria-label={zoom ? t.review.unzoom : t.review.zoom} onClick={() => setZoom((z) => (z ? null : { x: 50, y: 50 }))}>
            <Icon name="zoom" size={18} />
          </button>
          {!pass && !srcBroken && (
            <button
              type="button"
              className="ctool"
              aria-pressed={mode === 'flip'}
              aria-label={mode === 'split' ? t.review.toggleMode : t.review.splitMode}
              onClick={() => {
                const m = mode === 'split' ? 'flip' : 'split';
                setMode(m);
                setShowAfter(true);
                lsSet(MODE_KEY, m);
              }}
            >
              <Icon name="flip" size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="scrub">
        <button type="button" className="play" aria-label={playing ? t.review.pause : t.review.play} onClick={togglePlay}>
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, dur)}
          step={0.01}
          value={Math.min(time, dur)}
          aria-label={t.review.scrub}
          aria-valuetext={`${clock(time)} / ${clock(dur)}`}
          style={{ '--p': `${dur ? (time / dur) * 100 : 0}%` } as CSSProperties}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="t">
          {clock(time)} / {clock(dur)}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {mode === 'flip' ? t.review.showing(showAfter ? t.review.snug : t.review.original) : ''}
      </p>
    </>
  );
}

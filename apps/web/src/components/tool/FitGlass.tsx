// The measuring glass: the signature meter. Linear scale; the limit line always sits at
// LIMIT_LINE of the tube height, so every clip's fill is comparable. Output can never exceed
// the target, so the liquid never passes the line. Decorative (aria-hidden): the readout
// next to it carries the meaning.
import type { CSSProperties } from 'react';
import { fillLevel } from '@/lib/tool-model';

/** Where the limit line sits, as a fraction of the tube height from the bottom. */
export const LIMIT_LINE = 0.78;
/** CSS `top` of the limit line inside the tube. */
const LINE_TOP = `${Math.round((1 - LIMIT_LINE) * 1000) / 10}%`;
const pctTop = (f: number) => `${Math.round((1 - f) * 10000) / 100}%`;

type GlassState = 'idle' | 'analysing' | 'encoding' | 'done' | 'warn' | 'bad';

export function FitGlass({ bytes, target, settle = false }: { bytes: number; target: number; settle?: boolean }) {
  const level = fillLevel(bytes, target) * LIMIT_LINE;
  return (
    <div className={`glass full${settle ? ' settle' : ''}`} style={{ '--level': level } as CSSProperties} aria-hidden="true">
      <div className="tube">
        <div className="liq" />
        <div className="liq-top" />
        <div className="glint" />
      </div>
      <div className="ticks">
        {[0.25, 0.5, 0.75].map((f) => (
          <i key={f} style={{ top: pctTop(LIMIT_LINE * f) }} />
        ))}
      </div>
      <div className="limit" style={{ top: LINE_TOP }} />
    </div>
  );
}

export function MiniGlass({ bytes = 0, target, projected, state = 'idle', settle = false }: { bytes?: number; target: number; projected?: number; state?: GlassState; settle?: boolean }) {
  const level = fillLevel(bytes, target) * LIMIT_LINE;
  const cls = ['mini', state === 'analysing' ? 'analysing' : '', state === 'warn' ? 'warn' : '', state === 'bad' ? 'bad' : '', settle ? 'settle' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} style={{ '--level': level } as CSSProperties} aria-hidden="true">
      {state !== 'warn' && state !== 'bad' && <div className="liq" />}
      {state === 'encoding' && level > 0.02 && <div className="wave" />}
      {projected !== undefined && state === 'encoding' && (
        <div className="ghost" style={{ top: pctTop(fillLevel(projected, target) * LIMIT_LINE) }} />
      )}
      <div className="limit" style={{ top: LINE_TOP }} />
    </div>
  );
}

/** Empty glass illustration (drop card, unsupported state). A clip hovers over the rim and drops in on drag-over. */
export function EmptyGlass({ question = false, size = 64, dropping = false }: { question?: boolean; size?: number; dropping?: boolean }) {
  return (
    <svg className={`empty-glass${dropping ? ' dropping' : ''}`} width={size} height={size * 1.25} viewBox="0 -12 48 60" aria-hidden="true">
      {!question && (
        <g className="clip-card">
          <rect x="15" y="-9" width="18" height="13" rx="3.5" fill="var(--sn-surface)" stroke="var(--sn-ink-2)" strokeWidth="1.8" />
          <path d="M22.2 -5.3v5.6l4.6-2.8z" fill="var(--sn-liquid)" />
        </g>
      )}
      <path d="M9.5 8 11.9 35.4A7 7 0 0 0 18.9 41.8H29.1A7 7 0 0 0 36.1 35.4L38.5 8" fill="color-mix(in oklab, var(--sn-surface) 70%, transparent)" stroke="var(--sn-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15.5H43" stroke="var(--sn-limit)" strokeWidth="3" strokeLinecap="round" />
      <path d="M13.1 37.2c3.4 1.4 7 1.8 10.9 1.8s7.5-.4 10.9-1.8" fill="none" stroke="var(--sn-liquid)" strokeWidth="2.6" strokeLinecap="round" opacity=".6" />
      {question && (
        <text x="24" y="33" textAnchor="middle" fontFamily="var(--sn-font-display)" fontWeight="700" fontSize="14" fill="var(--sn-ink-2)">
          ?
        </text>
      )}
    </svg>
  );
}

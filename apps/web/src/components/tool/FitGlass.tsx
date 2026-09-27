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
      {state === 'warn' && <div className="spill" />}
      {state === 'bad' && (
        <svg className="mini-x" viewBox="0 0 10 10" width="10" height="10">
          <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
      {state === 'encoding' && level > 0.02 && <div className="wave" />}
      {projected !== undefined && state === 'encoding' && (
        <div className="ghost" style={{ top: pctTop(fillLevel(projected, target) * LIMIT_LINE) }} />
      )}
      <div className="limit" style={{ top: LINE_TOP }} />
    </div>
  );
}

/**
 * The brand tumbler as an illustration: liquid with the play cut-out, the coral limit line, and
 * an optional label beside the line. `level` 0..1 is the share of the height up to the line.
 */
export function EmptyGlass({ question = false, size = 64, level = 0.3, label }: { question?: boolean; size?: number; level?: number; label?: string }) {
  // Tumbler inner spans y 8 → 41.8; the line sits at y 15.5.
  const top = 41.8 - (41.8 - 15.5) * Math.max(0, Math.min(1, level));
  const w = label ? size * 2 : size;
  return (
    <svg className="empty-glass" width={w} height={size} viewBox={`0 0 ${label ? 96 : 48} 48`} aria-hidden="true">
      <defs>
        <clipPath id="eg-in">
          <path d="M9.5 8H38.5L36.1 35.4A7 7 0 0 1 29.1 41.8H18.9A7 7 0 0 1 11.9 35.4Z" />
        </clipPath>
        <mask id="eg-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48">
          <rect width="48" height="48" fill="#fff" />
          {!question && <path d="M21.2 28.4v8.2c0 .8.9 1.3 1.6.9l6.6-4.1c.6-.4.6-1.3 0-1.7l-6.6-4.1c-.7-.4-1.6.1-1.6.8Z" fill="#000" />}
        </mask>
      </defs>
      <path d="M9.5 8H38.5L36.1 35.4A7 7 0 0 1 29.1 41.8H18.9A7 7 0 0 1 11.9 35.4Z" fill="color-mix(in oklab, var(--sn-surface) 70%, transparent)" />
      <g clipPath="url(#eg-in)">
        <path className="eg-liq" style={{ transform: `translateY(${top}px)` }} d="M0 1.2C4 -.6 8 -.6 12 1.2S20 3 24 1.2 32 -.6 36 1.2 44 3 48 1.2V48H0Z" fill="var(--sn-liquid)" mask="url(#eg-cut)" />
      </g>
      <path d="M9.5 8 11.9 35.4A7 7 0 0 0 18.9 41.8H29.1A7 7 0 0 0 36.1 35.4L38.5 8" fill="none" stroke="var(--sn-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15.5H43" stroke="var(--sn-limit)" strokeWidth="3" strokeLinecap="round" />
      {label && (
        <text x="46" y="20" fontFamily="var(--sn-font-display)" fontWeight="600" fontSize="13" fill="var(--sn-limit-text)">
          {label}
        </text>
      )}
      {question && (
        <text x="24" y="33" textAnchor="middle" fontFamily="var(--sn-font-display)" fontWeight="700" fontSize="14" fill="var(--sn-ink-2)">
          ?
        </text>
      )}
    </svg>
  );
}

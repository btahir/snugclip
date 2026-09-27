'use client';
import { formatBitrate, formatDuration, formatSize, type Report } from '@snugclip/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/Icon';
import { t } from '@/i18n/en';
import { saveBlob } from '@/lib/download';
import { limitText, reductionText, resultSize, spareText } from '@/lib/format';
import type { Item } from '@/lib/tool-model';
import { Compare } from './Compare';
import { FitGlass } from './FitGlass';
import { useTool } from './ToolProvider';

const SETTLED = new Set<string>();

const Q: Record<string, { cls: string; label: string; sub: string; icon: IconName }> = {
  great: { cls: 'great', label: t.quality.great, sub: t.quality.greatSub, icon: 'ok' },
  softer: { cls: 'softer', label: t.quality.softer, sub: t.quality.softerSub, icon: 'half' },
  soft: { cls: 'soft', label: t.quality.soft, sub: t.quality.softSub, icon: 'eye' },
};

function encoderLabel(enc: string): string {
  const m = /webcodecs:(\w+)/.exec(enc);
  const names: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };
  if (m) return `WebCodecs ${names[m[1]!] ?? m[1]!.toUpperCase()}`;
  return enc;
}

function audioLabel(r: Report): string {
  const a = r.output?.audio;
  if (!a) return t.details.muted;
  const ch = a.channels === 1 ? 'mono' : 'stereo';
  if (a.codec === 'copy') {
    const src = r.input.probe?.audio;
    return t.details.audioKept(`${(src?.codec ?? 'aac').toUpperCase()}${src?.bitrate ? ` ${formatBitrate(src.bitrate)}` : ''} ${ch}`);
  }
  return `${a.codec.toUpperCase()} ${a.bitrate ? formatBitrate(a.bitrate) : ''} ${ch}`.replace(/\s+/g, ' ');
}

/** Details as a popover anchored to its link (desktop) or a bottom sheet (phone). Never resizes the card. */
function Details({ r, anchor, onClose }: { r: Report; anchor: HTMLElement | null; onClose: () => void }) {
  const { showToast, exportReport } = useTool();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; sheet: boolean } | null>(null);
  const o = r.output;
  const q = r.quality;
  const full = r.attempts.filter((a) => a.purpose !== 'calibration');
  const cal = r.attempts.filter((a) => a.purpose === 'calibration');

  useLayoutEffect(() => {
    const place = () => {
      const sheet = window.matchMedia('(max-width: 760px)').matches;
      if (sheet || !anchor) return setPos({ top: 0, left: 0, sheet: true });
      const a = anchor.getBoundingClientRect();
      const w = 360;
      const h = ref.current?.offsetHeight ?? 420;
      // Over the video, right-aligned to the side panel's left edge, so the readout stays visible.
      const panel = anchor.closest('.right')?.getBoundingClientRect();
      const leftOf = (panel ? panel.left : a.left) - w - 12;
      const left = leftOf >= 12 ? leftOf : Math.max(12, Math.min(a.right - w, window.innerWidth - w - 12));
      const top = Math.max(12, Math.min(a.top + a.height / 2 - h / 2, window.innerHeight - h - 12));
      setPos({ top, left, sheet: false });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchor?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && e.target !== anchor) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [anchor, onClose]);

  const group = (title: string, rows: [string, string][]) =>
    rows.length ? (
      <div className="dgroup">
        <h4>{title}</h4>
        <dl>
          {rows.map(([k, v]) => (
            <div key={k} className="drow">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    ) : null;

  const quality: [string, string][] = q
    ? [
        [t.details.ssimMean, q.ssimMean.toFixed(3)],
        [t.details.ssimMin, q.ssimMin.toFixed(3)],
        [t.details.psnr, `${q.psnrMean.toFixed(1)} dB`],
      ]
    : [];
  const file: [string, string][] = [];
  if (o?.video) {
    file.push([t.details.resolution, `${o.video.width} × ${o.video.height}`]);
    file.push([t.details.fps, `${Math.round(o.video.fps * 100) / 100} fps`]);
    file.push([t.details.codec, o.video.codec === 'h264' ? 'H.264' : o.video.codec.toUpperCase()]);
    if (o.video.bitrate) file.push([t.details.videoBitrate, formatBitrate(o.video.bitrate)]);
  }
  if (o) file.push([t.details.audio, audioLabel(r)]);
  if (o) file.push([t.details.exact, `${o.bytes.toLocaleString('en-US')} bytes`]);
  file.push([t.details.target, `${r.target.bytes.toLocaleString('en-US')} bytes`]);
  const tech: [string, string][] = [];
  if (full.length) tech.push([t.details.attempts, String(full.length)]);
  if (cal.length) tech.push([t.details.calibration, String(cal.length)]);
  if (r.complexity) tech.push([t.details.motion, r.complexity]);
  if (r.engine.encoder) tech.push([t.details.encoder, encoderLabel(r.engine.encoder)]);
  tech.push([t.details.time, formatDuration(r.elapsedMs / 1000)]);
  const json = JSON.stringify(r, null, 2);

  const body = (
    <>
      {pos?.sheet && <div className="sheet-scrim details-scrim" onClick={onClose} aria-hidden="true" />}
      <div
        ref={ref}
        tabIndex={-1}
        className={`details-pop${pos?.sheet ? ' sheet' : ''}`}
        role="dialog"
        aria-modal={pos?.sheet ? true : undefined}
        aria-label={t.review.details}
        style={pos && !pos.sheet ? { top: pos.top, left: pos.left } : pos ? undefined : { visibility: 'hidden' }}
        data-testid="details"
      >
        <div className="dhead">
          <b>{t.review.details}</b>
          <button type="button" className="btn quiet icon" aria-label={t.review.hideDetails} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {group(t.details.groupQuality, quality)}
        {group(t.details.groupFile, file)}
        {group(t.details.groupTech, tech)}
        <div className="dacts">
          <button
            type="button"
            className="btn sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(json);
                showToast(t.review.copied);
              } catch {
                saveBlob(new Blob([json], { type: 'application/json' }), 'snugclip-report.json');
              }
            }}
          >
            <Icon name="copy" size={16} />
            {t.review.copyReport}
          </button>
          <button type="button" className="btn sm" onClick={exportReport}>
            <Icon name="doc" size={16} />
            {t.review.saveReport}
          </button>
        </div>
      </div>
    </>
  );
  return createPortal(body, document.body);
}

export function ReviewCard({ it }: { it: Item }) {
  const tool = useTool();
  const r = it.report!;
  const target = r.target.bytes;
  const out = r.output?.bytes ?? it.bytes;
  const pass = r.passThrough;
  const [details, setDetails] = useState(false);
  const detailsBtn = useRef<HTMLButtonElement>(null);
  const [canShare, setCanShare] = useState(false);
  // Pour once per item; re-expanding shows the still level.
  const [settle] = useState(() => !pass && !SETTLED.has(it.id));
  useEffect(() => {
    SETTLED.add(it.id);
  }, [it.id]);
  useEffect(() => {
    try {
      // Probe with the real output type: Safari and Android share sheets accept MP4 but may refuse
      // WebM, and desktop Firefox has no Web Share at all (then Download is the only action).
      const type = it.output?.type || 'video/mp4';
      const f = new File([new Blob()], type === 'video/webm' ? 'x.webm' : 'x.mp4', { type });
      setCanShare(!!navigator.canShare?.({ files: [f] }) && matchMedia('(pointer: coarse)').matches);
    } catch {
      setCanShare(false);
    }
  }, [it.output]);

  const size = resultSize(out);
  const [num, unit] = size.split(' ');
  const spare = spareText(out, target);
  const limit = limitText(target);
  const v = r.input.probe?.video;
  const srcP = v ? `${Math.min(v.displayWidth, v.displayHeight)}p` : '';
  const outV = r.output?.video;
  const outP = outV && outV.width && outV.height ? `${Math.min(outV.width, outV.height)}p` : srcP;
  const fps = Math.round(outV?.fps ?? v?.fps ?? 0);
  const meta = [
    formatDuration(r.output?.durationSec ?? r.input.probe?.durationSec ?? 0),
    pass || srcP === outP ? srcP : `${srcP} \u2192 ${outP}`,
    fps ? `${fps} fps` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const q = r.quality ? Q[r.quality.verdict] : null;

  return (
    <div className="review">
      <div className="left">
        <Compare it={it} />
      </div>
      <div className="right">
        <div className="rhead">
          <div>
            <h3 className="fname" id={`title-${it.id}`} title={it.name}>
              {it.name}
            </h3>
            <p className="fmeta">{meta}</p>
          </div>
          <button type="button" className="btn quiet icon" aria-label={`${t.item.collapse}: ${it.name}`} aria-expanded={true} onClick={() => tool.expand(null)}>
            <Icon name="chevron" className="flip-y" />
          </button>
        </div>
        <div className="glassrow" role="group" aria-label={t.review.meterAria(size, limit, spare)} data-testid="meter">
          <FitGlass bytes={out} target={target} settle={settle} />
          <div className="readout">
            <div className="big" data-testid="result-size">
              {num}
              <small>{unit}</small>
            </div>
            <div className="of">
              {t.review.under} <b>{limit}</b> {t.review.line}
            </div>
            <div className="spare">
              {pass ? (
                <>
                  <span>{t.item.alreadyFits}</span>
                  <span>{t.review.spare(spare)}</span>
                </>
              ) : (
                t.review.spare(spare)
              )}
            </div>
            {!pass && <div className="was">{t.review.was(formatSize(it.bytes, { round: 'nearest' }), reductionText(it.bytes, out))}</div>}
          </div>
        </div>
        {pass ? (
          <div className="quality none" data-testid="quality">
            <Icon name="shield" size={22} />
            <div>
              <b>{t.review.untouched}</b>
              <span>{t.review.untouchedSub}</span>
            </div>
          </div>
        ) : q ? (
          <div className={`quality ${q.cls}`} data-testid="quality" data-verdict={r.quality!.verdict}>
            <Icon name={q.icon} size={22} />
            <div>
              <b>{q.label}</b>
              <span>{q.sub}</span>
            </div>
            <button ref={detailsBtn} type="button" className="qd" aria-expanded={details} aria-haspopup="dialog" onClick={() => setDetails((d) => !d)}>
              {t.review.details}
            </button>
          </div>
        ) : (
          <div className="quality none" data-testid="quality">
            <Icon name="info" size={22} />
            <div>
              <b>{t.quality.unknown}</b>
              <span>{t.quality.unknownSub}</span>
            </div>
            <button ref={detailsBtn} type="button" className="qd" aria-expanded={details} aria-haspopup="dialog" onClick={() => setDetails((d) => !d)}>
              {t.review.details}
            </button>
          </div>
        )}
        {details && <Details r={r} anchor={detailsBtn.current} onClose={() => setDetails(false)} />}
        <div className={`acts${canShare ? '' : ' single'}`}>
          <button type="button" className="btn primary" onClick={() => void tool.download(it.id)} data-testid="download">
            <Icon name="down" />
            {pass ? t.review.keepOriginal : it.downloaded ? t.review.downloadAgain : t.review.download}
          </button>
          {canShare && (
            <button type="button" className="btn soft" onClick={() => void tool.share(it.id)}>
              <Icon name="share" />
              {t.review.share}
            </button>
          )}
          {pass && (
            <button type="button" className="btn quiet" onClick={() => tool.retry(it.id, { reencode: true })}>
              {t.review.reencodeAnyway}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

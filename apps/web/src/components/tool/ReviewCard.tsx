'use client';
import { formatBitrate, formatDuration, formatSize, type Report } from '@snugclip/core';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { t } from '@/i18n/en';
import { saveBlob } from '@/lib/download';
import { limitText, reductionText, resolutionText, spareText } from '@/lib/format';
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

function Details({ r, onClose }: { r: Report; onClose: () => void }) {
  const { showToast, engineName } = useTool();
  const o = r.output;
  const q = r.quality;
  const full = r.attempts.filter((a) => a.purpose !== 'calibration');
  const cal = r.attempts.filter((a) => a.purpose === 'calibration');
  const rows: [string, string][] = [];
  if (q) {
    rows.push([t.details.ssimMean, q.ssimMean.toFixed(4)]);
    rows.push([t.details.ssimMin, q.ssimMin.toFixed(4)]);
    rows.push([t.details.psnr, `${q.psnrMean.toFixed(1)} dB`]);
  }
  if (o?.video) {
    rows.push([t.details.resolution, `${o.video.width}×${o.video.height}`]);
    rows.push([t.details.fps, `${Math.round(o.video.fps * 100) / 100}`]);
    rows.push([t.details.codec, o.video.codec.toUpperCase()]);
    if (o.video.bitrate) rows.push([t.details.videoBitrate, formatBitrate(o.video.bitrate)]);
  }
  if (o) rows.push([t.details.audio, o.audio ? `${o.audio.codec.toUpperCase()} ${o.audio.bitrate ? formatBitrate(o.audio.bitrate) : ''} ${o.audio.channels === 1 ? 'mono' : 'stereo'}`.trim() : t.details.muted]);
  if (full.length) rows.push([t.details.attempts, String(full.length)]);
  if (cal.length) rows.push([t.details.calibration, String(cal.length)]);
  if (r.complexity) rows.push([t.details.motion, r.complexity]);
  if (r.engine.encoder) rows.push([t.details.encoder, r.engine.encoder]);
  if (engineName) rows.push([t.details.engine, engineName]);
  if (o) rows.push([t.details.exact, `${o.bytes.toLocaleString('en-US')} B`]);
  rows.push([t.details.target, `${r.target.bytes.toLocaleString('en-US')} B`]);
  rows.push([t.details.time, formatDuration(r.elapsedMs / 1000)]);
  const json = JSON.stringify(r, null, 2);
  return (
    <div className="details" role="region" aria-label={t.review.details}>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="dacts">
        <button
          type="button"
          className="btn sm soft"
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
        <button type="button" className="btn sm quiet" onClick={onClose}>
          {t.review.hideDetails}
        </button>
      </div>
    </div>
  );
}

export function ReviewCard({ it }: { it: Item }) {
  const tool = useTool();
  const r = it.report!;
  const target = r.target.bytes;
  const out = r.output?.bytes ?? it.bytes;
  const pass = r.passThrough;
  const [details, setDetails] = useState(false);
  const [canShare, setCanShare] = useState(false);
  // Pour once per item; re-expanding shows the still level.
  const [settle] = useState(() => !pass && !SETTLED.has(it.id));
  useEffect(() => {
    SETTLED.add(it.id);
  }, [it.id]);
  useEffect(() => {
    try {
      const f = new File([new Blob()], 'x.mp4', { type: 'video/mp4' });
      setCanShare(!!navigator.canShare?.({ files: [f] }) && matchMedia('(pointer: coarse)').matches);
    } catch {
      setCanShare(false);
    }
  }, []);

  const size = formatSize(out);
  const [num, unit] = size.split(' ');
  const spare = spareText(out, target);
  const limit = limitText(target);
  const v = r.input.probe?.video;
  const meta = [formatDuration(r.output?.durationSec ?? r.input.probe?.durationSec ?? 0), resolutionText(r.output?.video?.width ?? v?.displayWidth, r.output?.video?.height ?? v?.displayHeight, r.output?.video?.fps ?? v?.fps), (r.output?.video?.codec ?? v?.codec ?? '').toUpperCase().replace('H264', 'H.264')].filter(Boolean).join(' · ');
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
            <div className="spare">{pass ? t.review.alreadyFits(spare) : t.review.spare(spare)}</div>
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
            <button type="button" className="qd" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
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
            <button type="button" className="qd" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              {t.review.details}
            </button>
          </div>
        )}
        {details && <Details r={r} onClose={() => setDetails(false)} />}
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

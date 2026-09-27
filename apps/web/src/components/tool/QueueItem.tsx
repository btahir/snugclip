'use client';
import { formatDuration, formatSize } from '@snugclip/core';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { etaText, limitText } from '@/lib/format';
import { maxFittingDuration, type Item } from '@/lib/tool-model';
import { MiniGlass } from './FitGlass';
import { ReviewCard } from './ReviewCard';
import { TrimTimeline } from './TrimTimeline';
import { useTool } from './ToolProvider';

function Thumb({ it, ok }: { it: Item; ok?: boolean }) {
  return (
    <div className={`rthumb${it.thumb ? '' : ' shimmer'}`} aria-hidden="true">
      {it.thumb && <img src={it.thumb} alt="" />}
      {ok && (
        <span className="badge">
          <Icon name="check" size={14} />
        </span>
      )}
    </div>
  );
}

function Title({ it, next }: { it: Item; next?: boolean }) {
  return (
    <h3 className="fname" title={it.name} id={`title-${it.id}`}>
      {it.name}
      {next && <span className="pill">{t.queue.next}</span>}
    </h3>
  );
}

export function QueueItem({ it, isNext }: { it: Item; isNext: boolean }) {
  const tool = useTool();
  const { state } = tool;
  const target = it.runTarget?.bytes ?? state.target.bytes;
  const expanded = state.expandedId === it.id && it.status === 'ready';
  const trimming = state.trimId === it.id;
  const dur = it.probe ? (it.trim ? it.trim.endSec - it.trim.startSec : it.probe.durationSec) : null;

  if (expanded) {
    return (
      <article className="card" aria-labelledby={`title-${it.id}`} data-state="review" data-id={it.id}>
        <ReviewCard it={it} />
        {trimming && <TrimTimeline it={it} />}
      </article>
    );
  }

  const remove = (
    <button type="button" className="btn quiet icon" aria-label={`${t.item.remove} ${it.name}`} onClick={() => tool.remove(it.id)}>
      <Icon name="x" />
    </button>
  );
  const trimBtn = it.probe && (
    <button type="button" className="btn quiet desk" aria-expanded={trimming} onClick={() => tool.openTrim(trimming ? null : it.id)}>
      {t.item.trim}
    </button>
  );

  let glass: React.ReactNode;
  let main: React.ReactNode;
  let actions: React.ReactNode;
  let strip: React.ReactNode = null;
  let waiting = false;
  let dataState: string = it.status;

  switch (it.status) {
    case 'probing': {
      glass = <MiniGlass target={target} state="analysing" />;
      main = (
        <>
          <Title it={it} />
          <p className="sub">{t.item.reading}</p>
        </>
      );
      actions = remove;
      waiting = true;
      break;
    }
    case 'queued': {
      glass = <MiniGlass target={target} />;
      const land = it.preview ? (it.preview.passThrough ? null : formatSize(it.preview.projectedBytes, { round: 'nearest' })) : null;
      main = (
        <>
          <Title it={it} next={isNext} />
          <p className="sub">
            {formatSize(it.bytes, { round: 'nearest' })} · {dur != null ? formatDuration(dur) : ''}
            {land && <span className="phone-hide"> · will land around {land}</span>}
          </p>
        </>
      );
      actions = (
        <>
          {trimBtn}
          {remove}
        </>
      );
      waiting = true;
      dataState = 'queued';
      break;
    }
    case 'running': {
      const p = it.progress;
      const phase = p?.phase ?? 'probing';
      const analysing = phase === 'probing' || phase === 'planning' || phase === 'calibrating';
      const checking = phase === 'checking';
      const pct = Math.floor((p?.overall ?? 0) * 100);
      const eta = etaText(p?.etaMs);
      const projected = it.preview?.projectedBytes;
      const bytesSoFar = projected && !analysing ? projected * Math.min(1, (p?.overall ?? 0) / 0.95) : 0;
      glass = <MiniGlass target={target} bytes={bytesSoFar} {...(projected ? { projected } : {})} state={analysing ? 'analysing' : 'encoding'} />;
      dataState = it.paused ? 'paused' : analysing ? 'analysing' : checking ? 'checking' : 'encoding';
      let sub: React.ReactNode;
      if (it.paused) sub = t.item.paused(pct);
      else if (analysing) sub = t.item.analysing;
      else if (checking) sub = t.item.checkingQuality;
      else if (p && p.attempt >= 2) sub = t.item.fineTuning(p.attempt, Math.max(p.attempt, p.expectedAttempts));
      else
        sub = (
          <>
            {t.item.compressing}
            {eta && (
              <>
                {' · '}
                <b>{t.item.left(eta)}</b>
              </>
            )}
            {projected && <span className="phone-hide"> · {t.item.heading(formatSize(projected, { round: 'nearest' }))}</span>}
          </>
        );
      main = (
        <>
          <Title it={it} />
          <div className="prog">
            <div
              className={`track${analysing && !it.paused ? ' indet' : ''}${it.paused ? ' paused' : ''}`}
              role="progressbar"
              aria-label={t.a11y.progress(it.name)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-valuetext={t.item.progressText(pct, eta)}
            >
              <i style={analysing && !it.paused ? undefined : { transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
            </div>
            <span className="pct mono">{pct}%</span>
          </div>
          <p className="sub">{sub}</p>
        </>
      );
      actions = (
        <>
          {!analysing && !checking && (
            <button
              type="button"
              className="btn quiet icon"
              aria-label={`${it.paused ? t.item.resume : t.item.pause} ${it.name}`}
              onClick={() => (it.paused ? tool.resume(it.id) : tool.pause(it.id))}
            >
              <Icon name={it.paused ? 'play' : 'pause'} />
            </button>
          )}
          <button type="button" className="btn quiet icon" aria-label={`${t.item.cancel} ${it.name}`} onClick={() => tool.cancel(it.id)}>
            <Icon name="x" />
          </button>
        </>
      );
      if (it.stalled && !it.paused) {
        strip = (
          <div className="notice warn strip" role="status">
            <Icon name="info" size={18} />
            <div>
              <b>{t.item.stallTitle}</b>
              <div className="actions">
                <button type="button" className="btn sm" onClick={() => tool.resume(it.id)}>
                  {t.item.keepWaiting}
                </button>
                <button type="button" className="btn sm quiet" onClick={() => tool.cancel(it.id)}>
                  {t.item.cancel}
                </button>
              </div>
            </div>
          </div>
        );
      }
      break;
    }
    case 'ready': {
      const r = it.report!;
      const out = r.output?.bytes ?? it.bytes;
      glass = <MiniGlass target={target} bytes={out} state="done" />;
      const quality = r.passThrough ? t.review.untouched : (r.quality?.label ?? null);
      const madeFor = it.runTarget && it.runTarget.bytes !== state.target.bytes;
      main = (
        <>
          <Title it={it} />
          <p className="sub">
            {t.item.doneSub(formatSize(out), quality, it.downloaded)}
            {madeFor && <span> · {t.item.madeFor(limitText(it.runTarget!.bytes))}</span>}
          </p>
        </>
      );
      actions = (
        <>
          {madeFor && (
            <button type="button" className="btn quiet desk" onClick={() => tool.retry(it.id)}>
              {t.item.redoFor(limitText(state.target.bytes))}
            </button>
          )}
          <button type="button" className="btn quiet icon" aria-label={`${it.downloaded ? t.review.downloadAgain : t.review.download} ${it.name}`} onClick={() => void tool.download(it.id)}>
            <Icon name="down" />
          </button>
          <button type="button" className="btn quiet icon" aria-label={`${t.item.expand}: ${it.name}`} aria-expanded={false} onClick={() => tool.expand(it.id)}>
            <Icon name="chevron" />
          </button>
        </>
      );
      dataState = 'done';
      break;
    }
    case 'impossible': {
      const min = it.report?.minimumBytes ?? it.preview?.minimumBytes ?? 0;
      const minText = formatSize(min, { round: 'ceil' });
      glass = <MiniGlass target={target} state="warn" />;
      main = (
        <>
          <Title it={it} />
          <p className="sub">
            {formatSize(it.bytes, { round: 'nearest' })} · {dur != null ? formatDuration(dur) : ''}
          </p>
        </>
      );
      actions = remove;
      const fitDur = dur && min ? maxFittingDuration(dur, min, state.target.bytes) : 0;
      strip = (
        <div className="notice warn strip" data-testid="impossible">
          <Icon name="spill" size={20} />
          <div>
            <span>
              {t.impossible.body(minText, limitText(state.target.bytes))} {fitDur >= 1 ? t.impossible.trimTo(formatDuration(fitDur)) : t.impossible.pickBigger}
            </span>
            <div className="actions">
              <button type="button" className="btn sm primary" onClick={() => tool.openTrim(it.id)} aria-expanded={trimming}>
                <Icon name="scissors" size={16} />
                {t.item.trim}
              </button>
              {it.probe?.audio && !(it.overrides?.mute ?? state.options.mute) && (
                <button type="button" className="btn sm" onClick={() => tool.retry(it.id, { mute: true })}>
                  <Icon name="mute" size={16} />
                  {t.impossible.mute}
                </button>
              )}
              <button
                type="button"
                className="btn sm quiet"
                onClick={() => {
                  const el = document.querySelector<HTMLElement>('.chips [role="radio"][aria-checked="true"]') ?? document.querySelector<HTMLElement>('.chips [role="radio"]');
                  el?.focus();
                  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }}
              >
                {t.impossible.bigger}
              </button>
            </div>
          </div>
        </div>
      );
      break;
    }
    case 'error': {
      glass = <MiniGlass target={target} state="bad" />;
      const e = it.error;
      const msg =
        e?.code === 'E_UNSUPPORTED' || e?.code === 'E_UNSUPPORTED_ENCODER'
          ? !it.probe
            ? t.errors.cantOpen(/\.([a-z0-9]{2,5})$/i.exec(it.name)?.[1] ?? '')
            : !it.probe.video
              ? t.errors.notVideo
              : t.errors.unsupportedFile((e.codec ?? it.probe.video.codec).toUpperCase())
          : e?.code === 'E_FIT_FAILED'
            ? t.errors.couldNotFit
            : e?.code === 'E_QUOTA'
              ? t.errors.quota
              : t.errors.generic(e?.message || e?.code || '');
      main = (
        <>
          <Title it={it} />
          <p className="sub">{formatSize(it.bytes, { round: 'nearest' })}</p>
        </>
      );
      actions = remove;
      strip = (
        <div className="notice bad strip" data-testid="error">
          <Icon name="info" size={18} />
          <div>
            <span>{msg}</span>
            <div className="actions">
              {e?.code !== 'E_UNSUPPORTED' && (
                <button type="button" className="btn sm" onClick={() => tool.retry(it.id)}>
                  <Icon name="retry" size={16} />
                  {t.item.retry}
                </button>
              )}
              <a className="btn sm quiet" href="/about/#formats">
                {t.errors.whatWorks}
              </a>
            </div>
          </div>
        </div>
      );
      break;
    }
    case 'cancelled': {
      glass = <MiniGlass target={target} />;
      main = (
        <>
          <Title it={it} />
          <p className="sub">{t.item.cancelledSub}</p>
        </>
      );
      actions = (
        <>
          <button type="button" className="btn quiet" onClick={() => tool.retry(it.id)}>
            <Icon name="retry" size={18} />
            <span className="desk">{t.item.retry}</span>
          </button>
          {remove}
        </>
      );
      waiting = true;
      break;
    }
  }

  return (
    <article className={`card${waiting ? ' waiting' : ''}`} aria-labelledby={`title-${it.id}`} data-state={dataState} data-id={it.id}>
      <div className="row">
        {glass}
        {it.status === 'ready' ? <Thumb it={it} ok /> : <Thumb it={it} />}
        <div className="rmain">{main}</div>
        <div className="ractions">{actions}</div>
      </div>
      {strip}
      {trimming && <TrimTimeline it={it} />}
    </article>
  );
}

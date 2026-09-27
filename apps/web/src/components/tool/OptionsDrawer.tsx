'use client';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { useTool } from './ToolProvider';

const RESOLUTIONS = [2160, 1440, 1080, 720, 480] as const;

function Switch({ checked, onChange, label, sub, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub: string; id: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-describedby={`${id}-sub`} className="switch-hit" onClick={() => onChange(!checked)}>
      <span>
        <span className="opt-label" style={{ fontWeight: 700, fontSize: 'var(--sn-text-sm)', display: 'block' }}>
          {label}
        </span>
        <span id={`${id}-sub`} className="opt-sub" style={{ fontSize: 'var(--sn-text-xs)', color: 'var(--sn-ink-3)' }}>
          {sub}
        </span>
      </span>
      <span className="switch" data-on={checked} aria-hidden="true" />
    </button>
  );
}

export function OptionsDrawer({ onClose, returnFocusTo }: { onClose: () => void; returnFocusTo?: () => HTMLElement | null }) {
  const { state, setOptions, caps, exportSetup, importJobFile, copySettingsLink } = useTool();
  const o = state.options;
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const smaller = o.codec === 'smaller' || o.codec === 'av1' || o.codec === 'hevc';
  const canSmaller = !caps || caps.videoCodecs.includes('av1') || caps.videoCodecs.includes('hevc');
  const container = o.codec === 'vp9' || (caps && !caps.videoCodecs.includes('h264') && caps.videoCodecs.includes('vp9')) ? 'WebM' : 'MP4';

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, select, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        returnFocusTo?.()?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, returnFocusTo]);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div id="options-drawer" ref={ref} className="drawer" role="region" aria-label={t.options.title}>
        <div className="drawer-head">
          <h2>{t.options.title}</h2>
          <button type="button" className="btn quiet icon" aria-label={t.options.close} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="opt-grid">
          <div className="opt" role="group" aria-labelledby="opt-codec">
            <span className="opt-label" id="opt-codec">
              {t.options.codecGroup}
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="opt-codec">
              <button type="button" role="radio" aria-checked={!smaller} onClick={() => setOptions({ codec: 'compatible' })}>
                {t.options.compatible}
                <small>{t.options.compatibleSub}</small>
              </button>
              <button type="button" role="radio" aria-checked={smaller} onClick={() => setOptions({ codec: 'smaller' })}>
                {t.options.smaller}
                <small>{t.options.smallerSub}</small>
              </button>
            </div>
            {smaller && (
              <p className="notice warn">
                <Icon name="info" size={18} />
                <span>{canSmaller ? t.options.smallerWarn : t.options.smallerUnavailable}</span>
              </p>
            )}
          </div>

          <div className="opt">
            <Switch id="opt-sound" checked={!o.mute} onChange={(v) => setOptions({ mute: !v })} label={t.options.sound} sub={t.options.soundSub} />
            <Switch id="opt-fps" checked={o.keepFps} onChange={(v) => setOptions({ keepFps: v })} label={t.options.fps} sub={t.options.fpsSub} />
          </div>

          <div className="opt">
            <label className="opt-label" htmlFor="opt-res">
              {t.options.resolution}
            </label>
            <select
              id="opt-res"
              className="select"
              value={o.maxShortSide ?? ''}
              onChange={(e) => setOptions({ maxShortSide: e.target.value ? Number(e.target.value) : (undefined as never) })}
            >
              <option value="">{t.options.resolutionAuto}</option>
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}p
                </option>
              ))}
            </select>
          </div>

          <div className="opt" role="radiogroup" aria-labelledby="opt-small">
            <span className="opt-label" id="opt-small">
              {t.options.small}
            </span>
            <div className="radio-list">
              <label className="radio">
                <input type="radio" name="opt-small" checked={!o.reencode} onChange={() => setOptions({ reencode: false })} />
                {t.options.keepOriginal}
              </label>
              <label className="radio">
                <input type="radio" name="opt-small" checked={o.reencode} onChange={() => setOptions({ reencode: true })} />
                {t.options.reencode}
              </label>
            </div>
          </div>

          <div className="opt">
            <span className="opt-label">{t.options.output}</span>
            <span className="mono" style={{ fontSize: 13 }}>
              {t.options.outputAuto(container)}
            </span>
            <span className="opt-sub">{t.options.outputNote}</span>
          </div>
        </div>
        <div className="opt-foot">
          <button type="button" className="btn soft sm" onClick={exportSetup}>
            <Icon name="doc" size={16} />
            {t.options.exportSetup}
          </button>
          <button type="button" className="btn soft sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} />
            {t.options.importSetup}
          </button>
          <button type="button" className="btn soft sm" onClick={() => void copySettingsLink()}>
            <Icon name="link" size={16} />
            {t.options.copyLink}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJobFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </>
  );
}

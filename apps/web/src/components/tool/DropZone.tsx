'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n/en';
import { EmptyGlass } from './FitGlass';
import { useTool } from './ToolProvider';

const ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv,.snugclip.json,application/json';

function countFiles(dt: DataTransfer | null): number | null {
  if (!dt) return null;
  let n = 0;
  for (const it of Array.from(dt.items ?? [])) if (it.kind === 'file') n++;
  return n || null;
}

/** Page-wide drag & drop + paste. A file drop never navigates away. */
export function useGlobalDrop() {
  const { addFiles } = useTool();
  const [over, setOver] = useState<number | null | false>(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(countFiles(e.dataTransfer));
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files, 'drop');
    };
    const paste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        addFiles(files, 'paste');
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [addFiles]);
  return over;
}

function Picker({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { addFiles } = useTool();
  return (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPT}
      hidden
      data-testid="file-input"
      aria-label={t.drop.pickerLabel}
      onChange={(e) => {
        if (e.target.files?.length) addFiles(e.target.files, 'picker');
        e.target.value = '';
      }}
    />
  );
}

export function DropCard({ over }: { over: number | null | false }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const title = over === false ? t.drop.title : over ? t.drop.letGo(over) : t.drop.letGoUnknown;
  return (
    <div className={`dropcard${over !== false ? ' over' : ''}`} onClick={(e) => e.target === e.currentTarget && inputRef.current?.click()}>
      <div onClick={() => inputRef.current?.click()}>
        <EmptyGlass size={72} dropping={over !== false} />
        <h2>{title}</h2>
        <p>
          {t.drop.or}{' '}
          <button
            type="button"
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            {t.drop.choose}
          </button>
        </p>
        <p className="formats">{t.drop.formats}</p>
      </div>
      <Picker inputRef={inputRef} />
    </div>
  );
}

export function DropStrip({ over }: { over: number | null | false }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { pasteFlash } = useTool();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!pasteFlash) return;
    setFlash(true);
    const h = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(h);
  }, [pasteFlash]);
  return (
    <div className={`dropstrip${over !== false ? ' over' : ''}${flash ? ' flash' : ''}`} onClick={() => inputRef.current?.click()}>
      <Icon name="plus" size={26} />
      <span>
        <b>{over !== false ? (over ? t.drop.letGo(over) : t.drop.letGoUnknown) : t.drop.addMore}</b>
        {over === false && (
          <span className="desk">
            {t.drop.addMoreRest}{' '}
            <button
              type="button"
              className="link-plain"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
            >
              {t.drop.choose}
            </button>
          </span>
        )}
      </span>
      <button type="button" className="sr-only" onClick={() => inputRef.current?.click()}>
        {t.drop.pickerLabel}
      </button>
      <Picker inputRef={inputRef} />
    </div>
  );
}

export function Trust() {
  return (
    <div className="trust">
      <span>
        <Icon name="shield" size={16} />
        {t.trust.private}
      </span>
      <span>
        <Icon name="wifi" size={16} />
        {t.trust.offline}
      </span>
      <span>
        <Icon name="ok" size={16} />
        {t.trust.never}
      </span>
    </div>
  );
}

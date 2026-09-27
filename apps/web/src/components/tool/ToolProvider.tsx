'use client';
// The tool's state and side effects: the worker, the sequential queue, downloads, share,
// job files, deep links, the support moment and screen-reader announcements.
import {
  createJob,
  formatSize,
  jobFromQueryWithNotices,
  jobOptions,
  jobTarget,
  parseJobWithWarnings,
  queryToRecord,
  serializeJob,
  targetLabel,
  type EngineCapabilities,
  type Job,
  type Target,
  type TrimRange,
} from '@snugclip/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { t } from '@/i18n/en';
import { defaultTarget, resolveDestinations } from '@/lib/destinations';
import { saveBlob } from '@/lib/download';
import { lsGet, lsSet, ssGet, ssSet } from '@/lib/storage';
import {
  DEFAULT_UI_OPTIONS,
  capsFromWire,
  coreOptions,
  isJobFile,
  isProbablyVideo,
  newId,
  nextRunnable,
  previewPlan,
  reducer,
  type Item,
  type ToolState,
  type UiOptions,
} from '@/lib/tool-model';
import { WorkerClient, WorkerFailure, type InitResult, type RunHandle } from '@/lib/worker-client';

const LAST_TARGET_KEY = 'snugclip-last-target';
const SUPPORT_DISMISSED_KEY = 'snugclip-support-dismissed';
const SUPPORT_SHOWN_KEY = 'snugclip-support-shown';

export type Support = 'unknown' | 'ok' | 'unsupported';

interface ToolApi {
  state: ToolState;
  support: Support;
  supportReason?: string;
  caps: EngineCapabilities | null;
  engineName: string;
  /** The browser can encode video but can't decode audio (Safari before 26): sound may need muting. */
  audioLimited: boolean;
  addFiles(files: File[] | FileList, source?: 'drop' | 'paste' | 'picker'): void;
  remove(id: string): void;
  cancel(id: string): void;
  pause(id: string): void;
  resume(id: string): void;
  retry(id: string, overrides?: { reencode?: boolean; mute?: boolean }): void;
  setTarget(target: Target): void;
  setOptions(o: Partial<UiOptions>): void;
  setTrim(id: string, trim: TrimRange | undefined): void;
  expand(id: string | null): void;
  openTrim(id: string | null): void;
  download(id: string): Promise<void>;
  downloadAll(): Promise<void>;
  share(id: string): Promise<void>;
  exportReport(): void;
  exportSetup(): void;
  importJobFile(file: File): Promise<void>;
  copySettingsLink(): Promise<void>;
  thumbs(file: Blob, times: number[], height: number): Promise<(Blob | null)[]>;
  clearDone(): void;
  toast: { id: number; text: string } | null;
  showToast(text: string): void;
  announcement: string;
  supportCard: boolean;
  dismissSupport(forever: boolean): void;
  pasteFlash: number;
}

const Ctx = createContext<ToolApi | null>(null);

export function useTool(): ToolApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTool outside ToolProvider');
  return v;
}

function readLastTarget(): Target | null {
  const raw = lsGet(LAST_TARGET_KEY);
  if (!raw) return null;
  try {
    const t0 = JSON.parse(raw) as Target;
    return typeof t0.bytes === 'number' && t0.bytes > 0 ? t0 : null;
  } catch {
    return null;
  }
}

function uiFromJobOptions(o: Job['options'] | undefined): Partial<UiOptions> {
  if (!o) return {};
  const out: Partial<UiOptions> = {};
  if (o.codec) out.codec = o.codec;
  if (o.mute !== undefined) out.mute = o.mute;
  if (o.keepFps !== undefined) out.keepFps = o.keepFps;
  if (o.reencode !== undefined) out.reencode = o.reencode;
  if (o.maxShortSide !== undefined) out.maxShortSide = o.maxShortSide;
  if (o.fpsCap !== undefined) out.fpsCap = o.fpsCap;
  return out;
}

export function ToolProvider({ children, initialTarget }: { children: ReactNode; initialTarget?: Target }) {
  const dests = useMemo(() => resolveDestinations(), []);
  const [state, dispatch] = useReducer(reducer, undefined, (): ToolState => ({
    target: initialTarget ?? defaultTarget(dests),
    options: { ...DEFAULT_UI_OPTIONS },
    items: [],
    expandedId: null,
    trimId: null,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const clientRef = useRef<WorkerClient | null>(null);
  const handles = useRef(new Map<string, RunHandle>());
  const probing = useRef(new Set<string>());
  const [init, setInit] = useState<InitResult | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [supportCard, setSupportCard] = useState(false);
  const [pasteFlash, setPasteFlash] = useState(0);
  const lastAnnounced = useRef(new Map<string, number>());

  const caps = useMemo(() => (init?.caps ? capsFromWire(init.caps) : null), [init]);
  const support: Support = init === null ? 'unknown' : init.supported ? 'ok' : 'unsupported';

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(h);
  }, [toast]);
  const announce = useCallback((text: string) => setAnnouncement(text), []);

  // Worker + capabilities.
  useEffect(() => {
    if (typeof Worker === 'undefined' || typeof VideoEncoder === 'undefined') {
      setInit({ caps: null, supported: false, reason: 'no-webcodecs', engine: 'none' });
      return;
    }
    const c = new WorkerClient();
    clientRef.current = c;
    let alive = true;
    c.init()
      .then((r) => alive && setInit(r))
      .catch(() => alive && setInit({ caps: null, supported: false, reason: 'worker-failed', engine: 'none' }));
    return () => {
      alive = false;
      c.terminate();
      clientRef.current = null;
    };
  }, []);

  // Remembered target (unless the page chose one) + deep link / job settings.
  useEffect(() => {
    const q = queryToRecord(window.location.search);
    const hasQuery = Object.keys(q).length > 0;
    if (!initialTarget) {
      const last = readLastTarget();
      if (last) dispatch({ type: 'setTarget', target: last });
    }
    if (hasQuery) {
      const { job, notices } = jobFromQueryWithNotices(q);
      try {
        if (job.target) dispatch({ type: 'setTarget', target: jobTarget(job as Job) });
      } catch {
        /* reported below */
      }
      const ui = uiFromJobOptions(job.options);
      if (Object.keys(ui).length) dispatch({ type: 'setOptions', options: ui });
      if (job.options?.trim) dispatch({ type: 'setDefaultTrim', trim: job.options.trim });
      if (notices.length) showToast(t.errors.deepLink(notices));
    }
  }, [initialTarget, showToast]);

  // Recompute plan previews when the target, options or capabilities change.
  useEffect(() => {
    if (!caps) return;
    for (const it of state.items) {
      if (!it.probe || (it.status !== 'queued' && it.status !== 'impossible')) continue;
      const pv = previewPlan(it.probe, state.target, coreOptions(state.options, it.trim, it.overrides), caps);
      if (!pv) continue;
      const status = pv.feasible ? 'queued' : 'impossible';
      const prev = it.preview;
      if (
        !prev ||
        prev.projectedBytes !== pv.projectedBytes ||
        prev.minimumBytes !== pv.minimumBytes ||
        prev.feasible !== pv.feasible ||
        prev.passThrough !== pv.passThrough ||
        prev.targetBytes !== pv.targetBytes ||
        it.status !== status
      ) {
        dispatch({ type: 'update', id: it.id, patch: { preview: pv, status, ...(status === 'queued' ? { error: undefined as never, report: undefined as never } : {}) } });
      }
    }
  }, [state.items, state.target, state.options, caps]);

  const finish = useCallback(
    (id: string, report: import('@snugclip/core').Report, output: Blob | null) => {
      handles.current.delete(id);
      const it = stateRef.current.items.find((i) => i.id === id);
      if (!it) return;
      const limit = targetLabel(report.target.bytes);
      if ((report.status === 'fit' || report.status === 'passthrough') && output) {
        const passThrough = report.status === 'passthrough';
        const url = URL.createObjectURL(output);
        const name = passThrough ? it.name : (report.output?.name ?? it.name);
        dispatch({ type: 'update', id, patch: { status: 'ready', report, output, outputUrl: url, outputName: name, progress: undefined as never, paused: false, stalled: false } });
        // Open the review for a real result; a pass-through only opens when nothing else is on its way.
        const others = stateRef.current.items.some((i) => i.id !== id && (i.status === 'running' || i.status === 'queued' || i.status === 'probing'));
        if (stateRef.current.expandedId === null && (!passThrough || !others)) dispatch({ type: 'expand', id });
        announce(
          passThrough
            ? t.item.announcePassthrough(it.name, limit)
            : t.item.announceDone(it.name, formatSize(report.output!.bytes), limit, report.quality?.label ?? null),
        );
        try {
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && !/iPhone|iPad/.test(navigator.userAgent)) navigator.vibrate?.(10);
        } catch {
          /* no haptics */
        }
      } else if (report.status === 'impossible') {
        dispatch({ type: 'update', id, patch: { status: 'impossible', report, progress: undefined as never, paused: false } });
        announce(t.item.announceImpossible(it.name, formatSize(report.minimumBytes ?? 0, { round: 'ceil' })));
      } else if (report.status === 'cancelled') {
        dispatch({ type: 'update', id, patch: { status: 'cancelled', report, progress: undefined as never, paused: false, stalled: false } });
      } else {
        const code = report.error?.code ?? 'E_INTERNAL';
        dispatch({
          type: 'update',
          id,
          patch: {
            status: 'error',
            report,
            progress: undefined as never,
            paused: false,
            stalled: false,
            error: { code, message: report.error?.message ?? '', ...(it.probe?.video?.codec ? { codec: it.probe.video.codec } : {}) },
          },
        });
        announce(t.item.announceError(it.name));
      }
    },
    [announce],
  );

  const start = useCallback(
    (it: Item) => {
      const c = clientRef.current;
      if (!c) return;
      const s = stateRef.current;
      const target = s.target;
      const options = coreOptions(s.options, it.trim, it.overrides);
      dispatch({ type: 'update', id: it.id, patch: { status: 'running', runTarget: target, paused: false, stalled: false, progress: undefined as never } });
      lastAnnounced.current.set(it.id, 0);
      const h = c.run(it.file, it.name, target, options, it.probe, {
        onProgress: (p) => {
          dispatch({ type: 'update', id: it.id, patch: { progress: p } });
          const q = Math.floor(p.overall * 4);
          if (q > (lastAnnounced.current.get(it.id) ?? 0) && q < 4) {
            lastAnnounced.current.set(it.id, q);
            announce(t.item.announceProgress(it.name, q * 25));
          }
        },
        onStall: () => dispatch({ type: 'update', id: it.id, patch: { stalled: true } }),
      });
      handles.current.set(it.id, h);
      h.done.then(
        ({ report, output }) => finish(it.id, report, output),
        (e: unknown) => {
          // The worker couldn't run this at all (it failed to load or crashed).
          handles.current.delete(it.id);
          const error = e instanceof WorkerFailure ? e.error : { code: 'E_INTERNAL', message: String(e) };
          dispatch({ type: 'update', id: it.id, patch: { status: 'error', progress: undefined as never, paused: false, stalled: false, error: { code: error.code, message: error.message } } });
          announce(t.item.announceError(it.name));
        },
      );
    },
    [announce, finish],
  );

  // The runner: one real encode at a time; pass-through items finish instantly alongside.
  useEffect(() => {
    if (support !== 'ok') return;
    for (const it of state.items) {
      if (it.status === 'queued' && it.preview?.passThrough && !handles.current.has(it.id)) start(it);
    }
    const next = nextRunnable(state.items.filter((i) => !(i.status === 'queued' && i.preview?.passThrough)));
    if (next && !handles.current.has(next.id)) start(next);
  }, [state.items, support, start]);

  const probeItem = useCallback(
    async (it: Item) => {
      const c = clientRef.current;
      if (!c) return;
      const { probe, error } = await c.probe(it.file);
      if (!stateRef.current.items.some((i) => i.id === it.id)) return;
      if (error || !probe) {
        dispatch({ type: 'update', id: it.id, patch: { status: 'error', error: { code: error?.code ?? 'E_UNSUPPORTED', message: error?.message ?? '', ...(error?.details?.codec ? { codec: String(error.details.codec) } : {}) } } });
        announce(t.item.announceError(it.name));
        return;
      }
      if (!probe.video || !probe.video.decodable) {
        dispatch({
          type: 'update',
          id: it.id,
          patch: { status: 'error', probe, error: { code: 'E_UNSUPPORTED', message: '', ...(probe.video ? { codec: probe.video.codec } : {}) } },
        });
        announce(t.item.announceError(it.name));
        return;
      }
      const s = stateRef.current;
      const cur = s.items.find((i) => i.id === it.id);
      const pv = caps ? previewPlan(probe, s.target, coreOptions(s.options, cur?.trim, cur?.overrides), caps) : null;
      dispatch({ type: 'update', id: it.id, patch: { probe, ...(pv ? { preview: pv } : {}), status: pv && !pv.feasible ? 'impossible' : 'queued' } });
      const tt = Math.min(Math.max(0.1 * probe.durationSec, 0), Math.max(0, probe.durationSec - 0.1));
      const [thumb] = await c.thumbs(it.file, [tt], 122).catch(() => [null]);
      if (thumb && stateRef.current.items.some((i) => i.id === it.id)) dispatch({ type: 'update', id: it.id, patch: { thumb: URL.createObjectURL(thumb) } });
    },
    [announce, caps],
  );

  // Probe newly added items once the worker is ready.
  useEffect(() => {
    if (support !== 'ok') return;
    for (const it of state.items) {
      if (it.status === 'probing' && !probing.current.has(it.id)) {
        probing.current.add(it.id);
        void probeItem(it);
      }
    }
  }, [state.items, support, probeItem]);

  const importJobFile = useCallback(
    async (file: File) => {
      try {
        const { job } = parseJobWithWarnings(JSON.parse(await file.text()));
        dispatch({ type: 'setTarget', target: jobTarget(job) });
        const o = jobOptions(job);
        dispatch({ type: 'setOptions', options: uiFromJobOptions(o) });
        dispatch({ type: 'setDefaultTrim', trim: o.trim });
        showToast(t.queue.jobLoaded);
      } catch (e) {
        showToast(t.errors.jobFile((e as Error).message));
      }
    },
    [showToast],
  );

  const addFiles = useCallback(
    (list: File[] | FileList, source: 'drop' | 'paste' | 'picker' = 'picker') => {
      const files = Array.from(list);
      const items: Item[] = [];
      for (const f of files) {
        if (isJobFile(f)) {
          void importJobFile(f);
          continue;
        }
        if (!isProbablyVideo(f)) {
          showToast(t.errors.notAVideoFile(f.name));
          continue;
        }
        const trim = stateRef.current.defaultTrim;
        items.push({ id: newId(), file: f, name: f.name, bytes: f.size, status: 'probing', paused: false, stalled: false, downloaded: false, ...(trim ? { trim } : {}) });
      }
      if (items.length) {
        dispatch({ type: 'add', items });
        if (source === 'paste') {
          setPasteFlash((n) => n + 1);
          showToast(t.toast.pasted(items.length));
        }
      }
    },
    [importJobFile, showToast],
  );

  const revoke = (it: Item | undefined) => {
    if (!it) return;
    if (it.outputUrl) URL.revokeObjectURL(it.outputUrl);
    if (it.thumb) URL.revokeObjectURL(it.thumb);
  };

  const remove = useCallback((id: string) => {
    handles.current.get(id)?.cancel();
    handles.current.delete(id);
    revoke(stateRef.current.items.find((i) => i.id === id));
    dispatch({ type: 'remove', id });
  }, []);

  const cancel = useCallback((id: string) => handles.current.get(id)?.cancel(), []);
  const pause = useCallback((id: string) => {
    handles.current.get(id)?.pause();
    dispatch({ type: 'update', id, patch: { paused: true } });
  }, []);
  const resume = useCallback((id: string) => {
    handles.current.get(id)?.resume();
    dispatch({ type: 'update', id, patch: { paused: false, stalled: false } });
  }, []);

  const retry = useCallback(
    (id: string, overrides?: { reencode?: boolean; mute?: boolean }) => {
      const it = stateRef.current.items.find((i) => i.id === id);
      if (!it) return;
      if (it.outputUrl) URL.revokeObjectURL(it.outputUrl);
      const s = stateRef.current;
      const itemOverrides = overrides ? { ...(it.overrides ?? {}), ...overrides } : it.overrides;
      const pv = it.probe && caps ? previewPlan(it.probe, s.target, coreOptions(s.options, it.trim, itemOverrides), caps) : null;
      if (s.expandedId === id) dispatch({ type: 'expand', id: null });
      dispatch({
        type: 'update',
        id,
        patch: {
          status: it.probe ? (pv && !pv.feasible ? 'impossible' : 'queued') : 'probing',
          report: undefined as never,
          output: undefined as never,
          outputUrl: undefined as never,
          error: undefined as never,
          downloaded: false,
          ...(itemOverrides ? { overrides: itemOverrides } : {}),
          ...(pv ? { preview: pv } : {}),
        },
      });
      if (!it.probe) probing.current.delete(id);
    },
    [caps],
  );

  const setTarget = useCallback(
    (target: Target) => {
      dispatch({ type: 'setTarget', target });
      lsSet(LAST_TARGET_KEY, JSON.stringify(target));
      const n = stateRef.current.items.filter((i) => i.status === 'queued' || i.status === 'impossible').length;
      if (n > 0 && stateRef.current.items.some((i) => i.status === 'running' || i.status === 'ready')) showToast(t.toast.applies(n));
    },
    [showToast],
  );

  const setOptions = useCallback(
    (o: Partial<UiOptions>) => {
      dispatch({ type: 'setOptions', options: o });
      const n = stateRef.current.items.filter((i) => i.status === 'queued' || i.status === 'impossible').length;
      if (n > 0) showToast(t.options.appliesTo(n));
    },
    [showToast],
  );

  const setTrim = useCallback(
    (id: string, trim: TrimRange | undefined) => {
      const it = stateRef.current.items.find((i) => i.id === id);
      dispatch({ type: 'update', id, patch: { trim: trim as TrimRange } });
      if (it && (it.status === 'ready' || it.status === 'cancelled' || it.status === 'error')) {
        // Re-run with the new range.
        setTimeout(() => retry(id), 0);
      }
    },
    [retry],
  );

  const markDownloaded = useCallback((ids: string[]) => {
    for (const id of ids) dispatch({ type: 'update', id, patch: { downloaded: true } });
    if (lsGet(SUPPORT_DISMISSED_KEY) !== '1' && ssGet(SUPPORT_SHOWN_KEY) !== '1') {
      ssSet(SUPPORT_SHOWN_KEY, '1');
      setSupportCard(true);
    }
  }, []);

  const download = useCallback(
    async (id: string) => {
      const it = stateRef.current.items.find((i) => i.id === id);
      if (!it?.output) return;
      saveBlob(it.output, it.outputName ?? it.name);
      showToast(t.review.saved(it.outputName ?? it.name));
      markDownloaded([id]);
    },
    [markDownloaded, showToast],
  );

  const downloadAll = useCallback(async () => {
    const ready = stateRef.current.items.filter((i) => i.status === 'ready' && i.output);
    if (!ready.length) return;
    if (ready.length === 1) return download(ready[0]!.id);
    showToast(t.toast.zipping);
    const { downloadZip } = await import('client-zip');
    const used = new Set<string>();
    const files = ready.map((i) => {
      let name = i.outputName ?? i.name;
      for (let n = 2; used.has(name); n++) name = name.replace(/(\.[^.]+)?$/, `-${n}$1`);
      used.add(name);
      return { name, input: i.output!, lastModified: new Date() };
    });
    const blob = await downloadZip(files).blob();
    const tag = targetLabel(stateRef.current.target.bytes).replace(/\s+/g, '');
    saveBlob(new Blob([blob], { type: 'application/zip' }), `snugclip-${tag}.zip`);
    markDownloaded(ready.map((i) => i.id));
  }, [download, markDownloaded, showToast]);

  const share = useCallback(
    async (id: string) => {
      const it = stateRef.current.items.find((i) => i.id === id);
      if (!it?.output) return;
      const file = new File([it.output], it.outputName ?? it.name, { type: it.output.type || 'video/mp4' });
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: file.name });
          markDownloaded([id]);
          return;
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
      showToast(t.toast.shareFailed);
      await download(id);
    },
    [download, markDownloaded, showToast],
  );

  const exportSetup = useCallback(() => {
    const s = stateRef.current;
    const job = createJob(s.target, coreOptions(s.options, s.defaultTrim));
    saveBlob(new Blob([serializeJob(job)], { type: 'application/json' }), 'snugclip-setup.snugclip.json');
  }, []);

  const exportReport = useCallback(() => {
    const s = stateRef.current;
    const reports = s.items.filter((i) => i.report).map((i) => i.report!);
    const job = createJob(s.target, coreOptions(s.options, s.defaultTrim), { reports });
    saveBlob(new Blob([serializeJob(job)], { type: 'application/json' }), 'snugclip-report.snugclip.json');
  }, []);

  const copySettingsLink = useCallback(async () => {
    const { jobToQuery } = await import('@snugclip/core');
    const s = stateRef.current;
    const tgt = s.target.presetId ? { preset: s.target.presetId } : { size: targetLabel(s.target.bytes).replace(/\s+/g, '') };
    const q = jobToQuery({ target: tgt, options: coreOptions(s.options, s.defaultTrim) });
    const url = `${window.location.origin}${window.location.pathname}${q ? `?${q}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t.options.linkCopied);
    } catch {
      showToast(url);
    }
  }, [showToast]);

  const thumbs = useCallback(async (file: Blob, times: number[], height: number) => {
    const c = clientRef.current;
    return c ? c.thumbs(file, times, height) : times.map(() => null);
  }, []);

  const dismissSupport = useCallback((forever: boolean) => {
    setSupportCard(false);
    if (forever) lsSet(SUPPORT_DISMISSED_KEY, '1');
  }, []);

  // Test hooks (used by Playwright; harmless otherwise).
  useEffect(() => {
    (window as unknown as { __snugclip?: unknown }).__snugclip = {
      state: () => stateRef.current,
      engine: init?.engine,
      reason: init?.reason,
    };
  }, [init]);

  const api: ToolApi = {
    state,
    support,
    ...(init?.reason ? { supportReason: init.reason } : {}),
    caps,
    engineName: init?.engine ?? '',
    audioLimited: !!init?.supported && init.env?.audioDecoder === false,
    addFiles,
    remove,
    cancel,
    pause,
    resume,
    retry,
    setTarget,
    setOptions,
    setTrim,
    expand: (id) => dispatch({ type: 'expand', id }),
    openTrim: (id) => dispatch({ type: 'trim', id }),
    download,
    downloadAll,
    share,
    exportReport,
    exportSetup,
    importJobFile,
    copySettingsLink,
    thumbs,
    clearDone: () => {
      for (const it of stateRef.current.items) if (it.status === 'ready' || it.status === 'cancelled') revoke(it);
      dispatch({ type: 'clearDone' });
    },
    toast,
    showToast,
    announcement,
    supportCard,
    dismissSupport,
    pasteFlash,
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

// Lazy AAC encoder for browsers without a native one (Firefox, Safari < 26), PLAN §8.5.
//
// The app serves `@mediabunny/aac-encoder`'s bundle unmodified. That file imports the bare
// specifier "mediabunny", which a worker can't resolve (no import maps in workers). So we fetch
// its text, point the bare specifier at a blob: URL of a tiny shim module that re-exports the
// mediabunny instance this engine already loaded, import the rewritten text from another blob:
// URL, and call its `registerAacEncoder()`. The file on disk stays unmodified.
//
// The text rewriting is pure and unit-tested; the loader takes its browser functions as
// injectable dependencies so it is tested in Node too.
import { AudioSample, CustomAudioEncoder, EncodedPacket, Logging, registerEncoder } from 'mediabunny';

/** The mediabunny exports the shim can provide. 1.60.0's encoder needs the first four. */
export const MEDIABUNNY_SHIM_EXPORTS: Readonly<Record<string, unknown>> = Object.freeze({
  Logging,
  CustomAudioEncoder,
  EncodedPacket,
  registerEncoder,
  AudioSample,
});

export const SHIM_GLOBAL_KEY = '__snugMediabunny';

const IDENT = /^[A-Za-z_$][\w$]*$/;
export function isIdentifier(s: string): boolean {
  return IDENT.test(s) && !RESERVED.has(s);
}
const RESERVED = new Set(['default', 'import', 'export', 'const', 'let', 'var', 'class', 'function', 'await', 'yield', 'new', 'delete', 'typeof', 'void', 'in', 'of', 'this', 'super', 'null', 'true', 'false']);

// `from "mediabunny"`, `import "mediabunny"`, `import("mediabunny")`, with either quote style.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])mediabunny\2/g;

/** Replaces every bare "mediabunny" module specifier with `shimUrl`. */
export function rewriteBareMediabunnyImport(text: string, shimUrl: string): string {
  return text.replace(SPECIFIER, (_m, lead: string) => `${lead}${JSON.stringify(shimUrl)}`);
}

/** How many bare "mediabunny" specifiers the text has. */
export function countBareMediabunnyImports(text: string): number {
  return (text.match(SPECIFIER) ?? []).length;
}

/**
 * Names imported from "mediabunny" via `import { A, B as c } from "mediabunny"`. Returns null if
 * the file uses a form we can't enumerate (namespace or default import), in which case the shim
 * exports everything it has.
 */
export function parseMediabunnyImportNames(text: string): string[] | null {
  const names = new Set<string>();
  const named = /\bimport\s*\{([^}]*)\}\s*from\s*(["'])mediabunny\2/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(text))) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  const other = /\bimport\s*(?:\*\s*as\s+[\w$]+|[\w$]+)\s*(?:,[^;]*?)?from\s*(["'])mediabunny\1/.test(text) || /\bimport\s*\(\s*(["'])mediabunny\1/.test(text);
  return other ? null : [...names];
}

/** Source of the shim module: `export const { A, B } = globalThis[key];` */
export function buildShimSource(names: readonly string[], globalKey: string = SHIM_GLOBAL_KEY): string {
  const bad = names.filter((n) => !isIdentifier(n));
  if (bad.length) throw new Error(`Invalid export name(s) for the mediabunny shim: ${bad.join(', ')}`);
  const unique = [...new Set(names)].sort();
  return `const m = globalThis[${JSON.stringify(globalKey)}];\nif (!m) throw new Error("mediabunny shim: namespace not set");\nexport const { ${unique.join(', ')} } = m;\n`;
}

/** Which shim exports a file needs, and whether we can provide them all. */
export function resolveShimExports(text: string, available: Readonly<Record<string, unknown>> = MEDIABUNNY_SHIM_EXPORTS): { names: string[]; missing: string[] } {
  const wanted = parseMediabunnyImportNames(text);
  const have = Object.keys(available);
  if (wanted === null) return { names: have, missing: [] };
  return { names: wanted.filter((n) => have.includes(n)), missing: wanted.filter((n) => !have.includes(n)) };
}

export interface AacLoaderDeps {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** Dynamic import that bundlers leave alone. */
  importModule: (url: string) => Promise<unknown>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  makeBlob: (parts: string[], type: string) => Blob;
  globalObject: Record<string, unknown>;
  namespace: Readonly<Record<string, unknown>>;
}

function defaultDeps(): AacLoaderDeps {
  return {
    fetch: (url) => globalThis.fetch(url),
    importModule: (url) => import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<unknown>,
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    makeBlob: (parts, type) => new Blob(parts, { type }),
    globalObject: globalThis as unknown as Record<string, unknown>,
    namespace: MEDIABUNNY_SHIM_EXPORTS,
  };
}

/**
 * Fetches the encoder bundle from `url` (the app's own origin), links it to our mediabunny and
 * registers it. Throws with a plain message on any failure.
 */
export async function loadAacEncoder(url: string, deps: Partial<AacLoaderDeps> = {}): Promise<void> {
  const d = { ...defaultDeps(), ...deps };
  const res = await d.fetch(url);
  if (!res.ok) throw new Error(`Couldn't load the AAC encoder (HTTP ${res.status}).`);
  const text = await res.text();
  const { names, missing } = resolveShimExports(text, d.namespace);
  if (missing.length) throw new Error(`The AAC encoder needs mediabunny exports this build doesn't provide: ${missing.join(', ')}.`);
  const urls: string[] = [];
  const g = d.globalObject;
  const had = Object.prototype.hasOwnProperty.call(g, SHIM_GLOBAL_KEY);
  try {
    g[SHIM_GLOBAL_KEY] = d.namespace;
    const shimUrl = d.createObjectURL(d.makeBlob([buildShimSource(names)], 'text/javascript'));
    urls.push(shimUrl);
    const moduleUrl = d.createObjectURL(d.makeBlob([rewriteBareMediabunnyImport(text, shimUrl)], 'text/javascript'));
    urls.push(moduleUrl);
    const mod = (await d.importModule(moduleUrl)) as { registerAacEncoder?: unknown } | null;
    if (!mod || typeof mod.registerAacEncoder !== 'function') throw new Error('The AAC encoder file has no registerAacEncoder().');
    (mod.registerAacEncoder as () => void)();
  } finally {
    for (const u of urls) d.revokeObjectURL(u);
    if (!had) delete g[SHIM_GLOBAL_KEY];
  }
}

const loaded = new Map<string, Promise<void>>();

/** `loadAacEncoder` once per URL per realm; a failed load can be retried. */
export function loadAacEncoderOnce(url: string, deps?: Partial<AacLoaderDeps>): Promise<void> {
  let p = loaded.get(url);
  if (!p) {
    p = loadAacEncoder(url, deps).catch((e: unknown) => {
      loaded.delete(url);
      throw e;
    });
    loaded.set(url, p);
  }
  return p;
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canEncodeAudio, Quality } from 'mediabunny';
import { describe, expect, it, vi } from 'vitest';
import {
  buildShimSource,
  countBareMediabunnyImports,
  loadAacEncoder,
  MEDIABUNNY_SHIM_EXPORTS,
  parseMediabunnyImportNames,
  resolveShimExports,
  rewriteBareMediabunnyImport,
  SHIM_GLOBAL_KEY,
} from '../src/aac-loader.js';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/@mediabunny/aac-encoder');
const bundlePath = join(pkgDir, 'dist/bundles/mediabunny-aac-encoder.min.mjs');
const bundle = readFileSync(bundlePath, 'utf8');

const dataUrl = (src: string) => `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`;

describe('rewriteBareMediabunnyImport', () => {
  it('rewrites minified, spaced, single-quoted, side-effect and dynamic forms', () => {
    const src = [
      'import{Logging as h}from"mediabunny";',
      "import { registerEncoder } from 'mediabunny';",
      'import "mediabunny";',
      'const m = await import("mediabunny");',
      'export { x } from "mediabunny";',
    ].join('\n');
    const out = rewriteBareMediabunnyImport(src, 'blob:shim-1');
    expect(countBareMediabunnyImports(out)).toBe(0);
    expect(out.match(/"blob:shim-1"/g)).toHaveLength(5);
    expect(out).toContain('import{Logging as h}from"blob:shim-1"');
    expect(out).toContain('await import("blob:shim-1")');
  });

  it('leaves other strings that merely mention mediabunny alone', () => {
    const src = 'console.log("mediabunny"); const s = "from mediabunny"; import x from "mediabunny-extra";';
    expect(rewriteBareMediabunnyImport(src, 'blob:x')).toBe(src);
  });

  it('rewrites the real 1.60.0 encoder bundle completely', () => {
    expect(countBareMediabunnyImports(bundle)).toBe(2);
    const out = rewriteBareMediabunnyImport(bundle, 'blob:shim');
    expect(countBareMediabunnyImports(out)).toBe(0);
    expect(out.length).toBe(bundle.length + 2 * ('blob:shim'.length - 'mediabunny'.length));
  });
});

describe('shim exports', () => {
  it('parses named imports, dropping aliases', () => {
    expect(parseMediabunnyImportNames('import{CustomAudioEncoder as m,EncodedPacket as G,registerEncoder as _}from"mediabunny"')).toEqual([
      'CustomAudioEncoder',
      'EncodedPacket',
      'registerEncoder',
    ]);
  });

  it('returns null for namespace or dynamic imports', () => {
    expect(parseMediabunnyImportNames('import * as M from "mediabunny"')).toBeNull();
    expect(parseMediabunnyImportNames('const M = await import("mediabunny")')).toBeNull();
  });

  it('the real bundle needs only exports the shim provides', () => {
    const { names, missing } = resolveShimExports(bundle);
    expect(missing).toEqual([]);
    expect(new Set(names)).toEqual(new Set(['Logging', 'CustomAudioEncoder', 'EncodedPacket', 'registerEncoder']));
    for (const n of names) expect(MEDIABUNNY_SHIM_EXPORTS[n]).toBeDefined();
  });

  it('reports exports the shim lacks', () => {
    expect(resolveShimExports('import{Nope}from"mediabunny"').missing).toEqual(['Nope']);
  });

  it('builds a valid shim module and rejects non-identifiers', () => {
    const src = buildShimSource(['b', 'a', 'a']);
    expect(src).toContain('export const { a, b } = m;');
    expect(src).toContain(JSON.stringify(SHIM_GLOBAL_KEY));
    expect(() => buildShimSource(['ok', 'not-valid'])).toThrow(/Invalid export/);
    expect(() => buildShimSource(['default'])).toThrow(/Invalid export/);
  });
});

describe('loadAacEncoder', () => {
  it('links the unmodified bundle to our mediabunny, registers it, and cleans up (end to end in Node)', async () => {
    const aacOpts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 128_000 }) };
    expect(await canEncodeAudio('aac', aacOpts)).toBe(false); // Node has no AudioEncoder
    const revoked: string[] = [];
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => bundle }));
    await loadAacEncoder('/vendor/aac-encoder-1.60.0.mjs', {
      fetch,
      createObjectURL: (b: Blob) => (b as unknown as { __src: string }).__src,
      makeBlob: (parts: string[]) => ({ __src: dataUrl(parts.join('')) }) as unknown as Blob,
      revokeObjectURL: (u: string) => void revoked.push(u),
      importModule: (u: string) => import(/* @vite-ignore */ u),
    });
    expect(fetch).toHaveBeenCalledWith('/vendor/aac-encoder-1.60.0.mjs');
    expect(revoked).toHaveLength(2);
    expect(SHIM_GLOBAL_KEY in globalThis).toBe(false);
    // The encoder registered into *our* mediabunny instance.
    expect(await canEncodeAudio('aac', aacOpts)).toBe(true);
  }, 30_000);

  it('fails clearly on HTTP errors and on files without registerAacEncoder', async () => {
    await expect(loadAacEncoder('/x', { fetch: async () => ({ ok: false, status: 404, text: async () => '' }) })).rejects.toThrow(/HTTP 404/);
    const revoked: string[] = [];
    await expect(
      loadAacEncoder('/y', {
        fetch: async () => ({ ok: true, status: 200, text: async () => 'export const nothing = 1;' }),
        createObjectURL: (b: Blob) => (b as unknown as { __src: string }).__src,
        makeBlob: (parts: string[]) => ({ __src: dataUrl(parts.join('')) }) as unknown as Blob,
        revokeObjectURL: (u: string) => void revoked.push(u),
        importModule: (u: string) => import(/* @vite-ignore */ u),
      }),
    ).rejects.toThrow(/registerAacEncoder/);
    expect(revoked).toHaveLength(2);
    expect(SHIM_GLOBAL_KEY in globalThis).toBe(false);
  });
});

// Settings deep links: `/?preset=discord&codec=h264&maxh=720`. Parsing is lenient (bad
// params are reported and ignored, so a typo never breaks the page); serialising omits
// defaults and uses a stable parameter order.
import { SITE_URL } from './constants.js';
import { getPreset } from './presets.js';
import { parseCodec, parseFps, parseTime } from './options.js';
import type { Options, Target } from './types.js';
import { formatTarget, parseSize } from './units.js';

export interface DeepLinkState {
  target: Target | null;
  options: Options;
  /** Problems with individual params (the rest still apply). */
  errors: string[];
}

function parseQuery(search: string): [string, string][] {
  const q = search.replace(/^[^?]*\?/, '').replace(/#.*$/, '');
  if (!q) return [];
  return q
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, ' '));
        } catch {
          return s;
        }
      };
      return i === -1 ? [dec(pair), ''] : [dec(pair.slice(0, i)), dec(pair.slice(i + 1))];
    });
}

const truthy = (v: string) => v === '' || v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';

/**
 * Parses a query string or URL (`?preset=discord&maxh=720`, or a full URL).
 * Recognised: preset, size, codec, maxh (alias max_height), fps, mute, trim (`start-end`
 * seconds or m:ss), reencode.
 */
export function parseDeepLink(search: string): DeepLinkState {
  const state: DeepLinkState = { target: null, options: {}, errors: [] };
  for (const [key, value] of parseQuery(search)) {
    try {
      switch (key.toLowerCase()) {
        case 'preset': {
          const p = getPreset(value);
          if (!p) throw new Error(`unknown preset "${value}"`);
          if (!state.target || state.target.presetId) state.target = { bytes: p.bytes, presetId: p.id, label: p.label };
          break;
        }
        case 'size': {
          const b = parseSize(value);
          if (b === null || b < 10_000) throw new Error(`bad size "${value}"`);
          state.target = { bytes: b, label: formatTarget(b) };
          break;
        }
        case 'codec':
          state.options.codec = parseCodec(value);
          break;
        case 'maxh':
        case 'max_height':
        case 'maxheight': {
          const n = Number(value);
          if (!(Number.isInteger(n) && n >= 64)) throw new Error(`bad max height "${value}"`);
          state.options.maxHeight = n;
          break;
        }
        case 'fps':
          state.options.fps = parseFps(value);
          break;
        case 'mute':
          state.options.mute = truthy(value);
          break;
        case 'reencode':
          state.options.reencode = truthy(value);
          break;
        case 'trim': {
          const m = /^([\d:.]+)?-([\d:.]+)?$/.exec(value);
          if (!m) throw new Error(`bad trim "${value}" (use start-end, e.g. 2.5-14)`);
          const start = m[1] ? parseTime(m[1]) : 0;
          const end = m[2] ? parseTime(m[2]) : Number.POSITIVE_INFINITY;
          if (!(end > start)) throw new Error(`trim end must be after start in "${value}"`);
          state.options.trim = { start, end };
          break;
        }
        default:
          break; // unknown params (utm_*, etc.) are ignored silently
      }
    } catch (e) {
      state.errors.push((e as Error).message);
    }
  }
  return state;
}

const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** Serialises settings to a query string (with leading `?`, or `''` when everything is default). */
export function serializeDeepLink(target: Target | null, options: Options = {}): string {
  const parts: string[] = [];
  if (target) {
    const p = target.presetId ? getPreset(target.presetId) : null;
    if (p && p.bytes === target.bytes) parts.push(`preset=${encodeURIComponent(p.id)}`);
    else parts.push(`size=${encodeURIComponent(formatTarget(target.bytes).replace(/\s+/g, ''))}`);
  }
  if (options.codec && options.codec !== 'compatible') parts.push(`codec=${options.codec}`);
  if (options.maxHeight != null) parts.push(`maxh=${options.maxHeight}`);
  if (options.fps !== undefined && options.fps !== 'auto') parts.push(`fps=${options.fps}`);
  if (options.mute) parts.push('mute=1');
  if (options.trim) {
    const end = Number.isFinite(options.trim.end) ? trimNum(options.trim.end) : '';
    parts.push(`trim=${trimNum(options.trim.start)}-${end}`);
  }
  if (options.reencode) parts.push('reencode=1');
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Full shareable URL for settings (defaults to the home page on SITE_URL). */
export function deepLinkUrl(target: Target | null, options: Options = {}, path = '/'): string {
  return `${SITE_URL}${path}${serializeDeepLink(target, options)}`;
}

#!/usr/bin/env node
// Exports PNG icons from the canonical SVGs in /brand (run via research/heavy.sh; uses Chrome):
//   public/icons/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180),
//   favicon-32.png, public/favicon.ico, and public/og/default.png (1200×630).
// brand/icon-pwa.svg is full-bleed with the mark inside the maskable safe zone, so the same art
// serves "any" and "maskable".
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brand = resolve(app, '../../brand');
const pub = join(app, 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });
mkdirSync(join(pub, 'og'), { recursive: true });
const pwa = readFileSync(join(brand, 'icon-pwa.svg'), 'utf8');
const fav = readFileSync(join(brand, 'favicon.svg'), 'utf8');
const logo = readFileSync(join(brand, 'logo-light.svg'), 'utf8');
const font = (f) => `data:font/woff2;base64,${readFileSync(join(app, 'node_modules/@fontsource-variable', f)).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
async function render(html, w, h, out, omitBackground = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}svg.full{width:${w}px;height:${h}px;display:block}</style></head><body>${html}</body></html>`);
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ omitBackground, clip: { x: 0, y: 0, width: w, height: h } });
  if (out) writeFileSync(out, buf);
  return buf;
}
const full = (svg) => svg.replace('<svg ', '<svg class="full" ');
for (const [size, name] of [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [512, 'icon-maskable-512.png'],
  [180, 'apple-touch-icon.png'],
]) {
  await render(full(pwa), size, size, join(pub, 'icons', name));
}
const fav32 = await render(full(fav.replace(/@media[^}]*}[^}]*}/, '')), 32, 32, join(pub, 'icons', 'favicon-32.png'), true);
// favicon.ico with one embedded 32×32 PNG.
const hdr = Buffer.alloc(22);
hdr.writeUInt16LE(0, 0);
hdr.writeUInt16LE(1, 2);
hdr.writeUInt16LE(1, 4);
hdr.writeUInt8(32, 6);
hdr.writeUInt8(32, 7);
hdr.writeUInt16LE(1, 10);
hdr.writeUInt16LE(32, 12);
hdr.writeUInt32LE(fav32.length, 14);
hdr.writeUInt32LE(22, 18);
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([hdr, fav32]));

// Default OG image: oat background, the glass, the coral line and the promise.
const og = `
<style>
@font-face{font-family:O;src:url(${font('outfit/files/outfit-latin-wght-normal.woff2')});font-weight:100 900}
@font-face{font-family:A;src:url(${font('atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2')});font-weight:200 800}
@font-face{font-family:M;src:url(${font('jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')});font-weight:100 800}
body{background:#F5F1E9;font-family:A;color:#132730}
.wrap{position:absolute;inset:0;padding:72px 80px;display:grid;grid-template-columns:1fr 330px;gap:40px;align-items:center}
.logo svg{height:56px;width:auto}
h1{font:650 78px/1.02 O;letter-spacing:-.03em;margin:34px 0 0}
h1 em{font-style:normal;color:#08756F}
p{font-size:28px;color:#3D525A;margin:22px 0 0;line-height:1.35}
.chips{display:flex;gap:12px;margin-top:34px}
.chip{font:600 20px M;background:#fff;border:1px solid #E5DFD3;border-radius:99px;padding:10px 18px;color:#132730}
</style>
<div class="wrap"><div><div class="logo">${logo}</div><h1>Fits under the limit. <em>Every time.</em></h1><p>Free video compressor for Discord, WhatsApp and email. Never uploaded, never over.</p>
<div class="chips"><span class="chip">Discord 20 MB</span><span class="chip">WhatsApp 64 MB</span><span class="chip">Email 14.5 MB</span></div></div>
<svg width="330" height="450" viewBox="0 0 220 300"><defs><clipPath id="c"><path d="M40 40h120l-10 208a26 26 0 0 1-26 24H76a26 26 0 0 1-26-24Z"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6ADBCB"/><stop offset=".3" stop-color="#1C9F92"/><stop offset="1" stop-color="#0E8C80"/></linearGradient></defs>
<path d="M40 40h120l-10 208a26 26 0 0 1-26 24H76a26 26 0 0 1-26-24Z" fill="#fff" opacity=".7"/><g clip-path="url(#c)"><path d="M20 104c20-8 40-8 60 0s40 8 60 0 40-8 60 0v200H20Z" fill="url(#g)"/><path d="M20 104c20-8 40-8 60 0s40 8 60 0 40-8 60 0" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="4"/><rect x="62" y="116" width="7" height="130" rx="3.5" fill="#fff" opacity=".3"/></g>
<path d="M40 40l10 208a26 26 0 0 0 26 24h48a26 26 0 0 0 26-24l10-208" fill="none" stroke="#132730" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 88h156" stroke="#D2453A" stroke-width="6" stroke-linecap="round"/><path d="M186 88l-10-7v14z" fill="#D2453A"/></svg></div>`;
await render(og, 1200, 630, join(pub, 'og', 'default.png'));
await browser.close();
console.log('icons + og exported');

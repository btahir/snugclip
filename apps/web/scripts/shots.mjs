#!/usr/bin/env node
// Screenshots of every screen in light/dark × desktop/phone for design review.
//   node scripts/shots.mjs <outDir> [baseUrl] [--only=empty,queue,pages] [--themes=light,dark] [--vps=desktop,phone]
// Uses installed Chrome (real H.264 encoding) and synthetic fixtures from fixtures/generated.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'test-results/shots');
const base = args.filter((a) => !a.startsWith('--'))[1] ?? 'http://localhost:4317';
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d).split(',');
const only = opt('only', 'empty,queue,options,extra,pages');
const themes = opt('themes', 'light,dark');
const vps = opt('vps', 'desktop,phone');
const FIX = resolve(new URL('../../../fixtures/generated', import.meta.url).pathname);
const VP = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
mkdirSync(out, { recursive: true });

const errors = [];
{
  for (const theme of themes) {
    for (const vp of vps) {
      const browser = await chromium.launch({ channel: 'chrome', headless: true });
      const ctx = await browser.newContext({ viewport: VP[vp], colorScheme: theme, deviceScaleFactor: vp === 'phone' ? 2 : 1, isMobile: vp === 'phone', hasTouch: vp === 'phone' });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${theme}/${vp}: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && errors.push(`${theme}/${vp} console: ${m.text()}`));
      const ready = async () => {
        for (let i = 0; i < 3; i++) {
          try {
            await page.waitForSelector('[data-support="ok"]', { timeout: 20000 });
            return;
          } catch {
            errors.push(`${theme}/${vp}: tool not ready (${await page.getAttribute('#tool', 'data-support').catch(() => '?')}), reloading`);
            await page.reload({ waitUntil: 'load' });
          }
        }
        throw new Error('tool never became ready');
      };
      const shot = async (name, full = true) => {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/${name}-${vp}-${theme}.png`, fullPage: full });
      };
      if (only.includes('empty')) {
        await page.goto(base + '/', { waitUntil: 'load' });
        await shot('home-empty', false);
      }
      if (only.includes('queue')) {
        await page.goto(base + '/?size=2MB', { waitUntil: 'load' });
        await ready();
        await page.setInputFiles('[data-testid="file-input"]', [
          `${FIX}/f01-testsrc2-1080p30-10s.mp4`,
          `${FIX}/f03-screen-1080p30-30s.mp4`,
          `${FIX}/f07-portrait-720x1280-5s.mp4`,
          `${FIX}/f11-long-360p30-300s.mp4`,
          `${FIX}/f15-mpeg2-240p-2s.mpg`,
        ]);
        await page.waitForSelector('[data-state="encoding"], [data-state="analysing"]', { timeout: 60000 });
        await page.waitForTimeout(1500);
        await shot('home-queue-running');
        await page.waitForSelector('[data-state="review"]', { timeout: 180000 });
        await page.waitForTimeout(1200);
        await shot('home-review');
        const trimBtn = page.locator('[data-state="impossible"] button', { hasText: 'Trim' });
        await trimBtn.click();
        await page.waitForTimeout(2500);
        await page.locator('[data-state="impossible"]').scrollIntoViewIfNeeded();
        await shot('home-trim', false);
        await page.keyboard.press('Escape');
      }
      if (only.includes('options')) {
        await page.goto(base + '/', { waitUntil: 'load' });
        await ready();
        await page.getByRole('button', { name: 'Options' }).first().click();
        await page.getByRole('radio', { name: /Smaller/ }).click();
        await shot('home-options', false);
      }
      if (only.includes('extra')) {
        // Drag-over state
        await page.goto(base + '/', { waitUntil: 'load' });
        await ready();
        await page.evaluate(() => {
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' }));
          dt.items.add(new File([new Uint8Array(8)], 'clip2.mp4', { type: 'video/mp4' }));
          window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
        });
        await shot('x-dragover', false);
        await page.evaluate(() => window.dispatchEvent(new DragEvent('drop', { dataTransfer: new DataTransfer(), bubbles: true })));
        // Tier popover
        await page.goto(base + '/', { waitUntil: 'load' });
        await ready();
        await page.locator('.chips [data-dest="discord"]').click();
        await shot('x-tier-popover', false);
        await page.keyboard.press('Escape');
        // Details, after download, pass-through
        await page.goto(base + '/?size=3MB', { waitUntil: 'load' });
        await ready();
        await page.setInputFiles('[data-testid="file-input"]', [`${FIX}/f01-testsrc2-1080p30-10s.mp4`]);
        await page.waitForSelector('[data-state="review"]', { timeout: 120000 });
        await page.waitForTimeout(900);
        await shot('x-single-review', false);
        await page.getByRole('button', { name: 'Details' }).click();
        await shot('x-details', false);
        await page.keyboard.press('Escape');
        await page.getByTestId('download').click();
        await page.waitForTimeout(300);
        await shot('x-after-download', false);
        await page.goto(base + '/?size=10MB', { waitUntil: 'load' });
        await ready();
        await page.setInputFiles('[data-testid="file-input"]', [`${FIX}/f12-tiny-360p-5s.mp4`]);
        await page.waitForSelector('[data-state="review"]', { timeout: 60000 });
        await shot('x-passthrough', false);
        // Unsupported browser
        const up = await ctx.newPage();
        await up.addInitScript(() => { delete window.VideoEncoder; });
        await up.goto(base + '/', { waitUntil: 'load' });
        await up.waitForSelector('[data-testid="unsupported"]', { timeout: 20000 });
        await up.waitForTimeout(600);
        await up.screenshot({ path: `${out}/x-unsupported-${vp}-${theme}.png` });
        await up.close();
      }
      if (only.includes('pages')) {
        await page.emulateMedia({ reducedMotion: 'reduce' }); // show settled glasses in full-page captures
        for (const p of opt('pages', 'compress-video-for-discord,compress-video-to-10mb,support,about')) {
          await page.goto(`${base}/${p}/`, { waitUntil: 'load' });
          await shot(p, true);
        }
      }
      await ctx.close();
      await browser.close();
    }
  }
}
console.log(`shots → ${out}`);
if (errors.length) console.log('ERRORS:\n' + [...new Set(errors)].join('\n'));

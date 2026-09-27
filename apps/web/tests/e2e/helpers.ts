import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

export const FIX = fileURLToPath(new URL('../../../../fixtures/generated/', import.meta.url));
export const fx = (name: string) => FIX + name;
export const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
export const size = (p: string) => statSync(p).size;

export async function ready(page: Page) {
  await page.waitForSelector('#tool[data-support="ok"]', { timeout: 30_000 });
}

export async function items(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __snugclip: { state: () => { items: Array<Record<string, unknown>> } } }).__snugclip.state();
    return s.items.map((i) => ({ name: i.name as string, status: i.status as string, report: i.report as Record<string, any> | undefined }));
  });
}

export async function drop(page: Page, files: string[]) {
  await page.setInputFiles('[data-testid="file-input"]', files);
}

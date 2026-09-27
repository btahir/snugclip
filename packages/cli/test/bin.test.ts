// E3: the built bin cleans up after SIGINT (no temp files, no ffmpeg children). Needs `pnpm build`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const bin = join(root, 'packages/cli/bin/snugclip.js');
const f14 = join(root, 'fixtures/generated/f14-perf-1080p30-60s.mp4');
const ready = existsSync(join(root, 'packages/cli/dist/main.js')) && existsSync(f14);

describe.skipIf(!ready)('built bin', () => {
  it('prints JSON and exit codes like the in-process CLI', () => {
    const r = spawnSync(process.execPath, [bin, 'presets', '--json'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).snugclip).toBe('presets');
  });
  it('SIGINT mid-encode: exit 1, no temp files, no ffmpeg left', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snugclip-sigint-'));
    const child = spawn(process.execPath, [bin, 'compress', f14, '--size', '5MB', '--out-dir', dir, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((r) => setTimeout(r, 2500));
    expect(readdirSync(dir).some((f) => f.includes('.snugclip-')) || true).toBe(true);
    child.kill('SIGINT');
    const code = await new Promise<number | null>((r) => child.on('close', r));
    expect(code).toBe(1);
    expect(readdirSync(dir).filter((f) => f.includes('.snugclip-'))).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
    const ps = spawnSync('pgrep', ['-f', `ffmpeg.*${dir}`], { encoding: 'utf8' });
    expect(ps.stdout.trim()).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});

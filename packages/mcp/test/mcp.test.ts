// F1/F2: scripted stdio MCP session against the built `snugclip-mcp` (needs `pnpm build` and fixtures).
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import AjvModule from 'ajv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const FX = join(root, 'fixtures/generated');
const bin = join(root, 'packages/mcp/bin/snugclip-mcp.js');
const ready = existsSync(join(root, 'packages/mcp/dist/index.js')) && existsSync(join(FX, 'f17-not-video.mp4'));
const fx = (id: string) => join(FX, readdirSync(FX).find((f) => f.startsWith(id.toLowerCase()))!);

describe.skipIf(!ready)('snugclip-mcp over stdio', () => {
  let client: Client;
  let out: string;
  const schemas = new Map<string, object>();
  // The SDK publishes tool schemas as draft-07.
  const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv as unknown as new (o: object) => { validate(s: object, d: unknown): boolean; errors: unknown })({ strict: false, allErrors: true });

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'snugclip-mcp-'));
    client = new Client({ name: 'snugclip-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin], cwd: root, stderr: 'pipe' }));
  });
  afterAll(async () => {
    await client?.close();
    rmSync(out, { recursive: true, force: true });
  });

  const validate = (tool: string, structured: unknown) => {
    const ok = ajv.validate(schemas.get(tool)!, structured);
    expect(ok, JSON.stringify(ajv.errors)).toBe(true);
  };

  it('lists exactly the four tools, each with input and output schemas', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['compress_video', 'list_presets', 'plan_compression', 'probe_video']);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema?.type).toBe('object');
      expect(t.description!.length).toBeGreaterThan(40);
      schemas.set(t.name, t.outputSchema!);
    }
  });
  it('list_presets', async () => {
    const r = await client.callTool({ name: 'list_presets', arguments: {} });
    const s = r.structuredContent as { presets: { id: string; bytes: number }[] };
    validate('list_presets', s);
    expect(s.presets.find((p) => p.id === 'discord')?.bytes).toBe(20_000_000);
  });
  it('probe_video F06: rotation 90 → display 1080x1920', async () => {
    const r = await client.callTool({ name: 'probe_video', arguments: { inputs: [fx('F06')] } });
    validate('probe_video', r.structuredContent);
    const probe = (r.structuredContent as { results: { probe: { video: object } }[] }).results[0]!.probe;
    expect(probe.video).toMatchObject({ displayWidth: 1080, displayHeight: 1920, rotation: 270 });
  });
  it('plan_compression F11 at 0.5 MB: infeasible with minimumBytes', async () => {
    const r = await client.callTool({ name: 'plan_compression', arguments: { inputs: [fx('F11')], target: { size: '0.5MB' } } });
    validate('plan_compression', r.structuredContent);
    const plan = (r.structuredContent as { results: { plan: { feasible: boolean; minimumBytes: number } }[] }).results[0]!.plan;
    expect(plan.feasible).toBe(false);
    expect(plan.minimumBytes).toBeGreaterThan(500_000);
  });
  it('compress_video F03 at 2 MB with progress notifications', async () => {
    const progress: number[] = [];
    const r = await client.callTool(
      { name: 'compress_video', arguments: { inputs: [fx('F03')], target: { size: '2MB' }, outputDir: out } },
      undefined,
      { onprogress: (p) => progress.push(p.progress), timeout: 170_000 },
    );
    expect(r.isError).toBeFalsy();
    validate('compress_video', r.structuredContent);
    const rep = (r.structuredContent as { results: { status: string; output: { bytes: number; path: string } }[] }).results[0]!;
    expect(rep.status).toBe('fit');
    expect(rep.output.bytes).toBeLessThanOrEqual(2_000_000);
    expect(statSync(rep.output.path).size).toBe(rep.output.bytes);
    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect((r.content as { text: string }[])[0]!.text).toMatch(/^fit:/);
  });
  it('errors: probe_video on F17 → isError with E_UNSUPPORTED; bad target → E_ARGS', async () => {
    const r = await client.callTool({ name: 'probe_video', arguments: { inputs: [fx('F17')] } });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toMatchObject({ code: 'E_UNSUPPORTED' });
    const t = await client.callTool({ name: 'plan_compression', arguments: { inputs: [fx('F01')], target: { size: '1MB', preset: 'discord' } } });
    expect(t.isError).toBe(true);
    expect(JSON.parse((t.content as { text: string }[])[0]!.text)).toMatchObject({ code: 'E_ARGS' });
  });
  it('cancel during compress_video: no output and no temp files left (F2)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'snugclip-mcp-cancel-'));
    const ac = new AbortController();
    const call = client.callTool({ name: 'compress_video', arguments: { inputs: [fx('F14')], target: { size: '5MB' }, outputDir: dir } }, undefined, { signal: ac.signal, timeout: 170_000 });
    setTimeout(() => ac.abort('test cancel'), 2000);
    await expect(call).rejects.toThrow();
    // Give the server a moment to kill ffmpeg and delete temps.
    for (let i = 0; i < 40 && readdirSync(dir).length; i++) await new Promise((r) => setTimeout(r, 250));
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

import { defineConfig } from 'vitest/config';

const resolve = { conditions: ['source'] };

export default defineConfig({
  resolve,
  test: {
    projects: [
      { resolve, test: { name: 'core', include: ['packages/core/test/**/*.test.ts'] } },
      { resolve, test: { name: 'engine-web', include: ['packages/engine-web/test/**/*.test.ts'] } },
      {
        resolve,
        test: { name: 'engine-ffmpeg', include: ['packages/engine-ffmpeg/test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 },
      },
      { resolve, test: { name: 'cli', include: ['packages/cli/test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } },
      { resolve, test: { name: 'mcp', include: ['packages/mcp/test/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 120_000 } },
    ],
  },
});

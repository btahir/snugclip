import { defineConfig } from 'vitest/config';

// Workspace packages export `source: ./src/index.ts`; tests run against source, no build needed.
const conditions = ['source', 'import', 'module', 'node', 'default'];
const base = { resolve: { conditions }, ssr: { resolve: { conditions, externalConditions: ['source'] } } };
const slow = { testTimeout: 180_000, hookTimeout: 180_000 };

export default defineConfig({
  ...base,
  test: {
    projects: [
      { ...base, test: { name: 'core', include: ['packages/core/test/**/*.test.ts'] } },
      { ...base, test: { name: 'engine-web', include: ['packages/engine-web/test/**/*.test.ts'] } },
      { ...base, test: { name: 'engine-ffmpeg', include: ['packages/engine-ffmpeg/test/**/*.test.ts'], exclude: ['**/*.local.test.ts'], ...slow } },
      { ...base, test: { name: 'cli', include: ['packages/cli/test/**/*.test.ts'], ...slow } },
      { ...base, test: { name: 'mcp', include: ['packages/mcp/test/**/*.test.ts'], ...slow } },
      { ...base, test: { name: 'local', include: ['packages/*/test/**/*.local.test.ts'], ...slow } },
    ],
  },
});

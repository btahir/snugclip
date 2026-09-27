import type { NextConfig } from 'next';

/**
 * Snugclip is a static site: no server, no API routes, no image optimiser (sharp is excluded
 * for licence reasons). `next build` writes the whole site to `out/`, then
 * `scripts/build-sw.mjs` adds the Serwist service worker that precaches it for offline use.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@snugclip/core', '@snugclip/engine-web'],
  agentRules: false,
  // Built with webpack (`--webpack`): workspace packages are TypeScript sources with NodeNext
  // `.js` import specifiers, consumed through their `source` export condition, never a stale dist.
  webpack(config) {
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), '.js': ['.ts', '.tsx', '.js'] };
    config.resolve.conditionNames = ['source', ...(config.resolve.conditionNames ?? ['import', 'module', 'require', 'default'])];
    return config;
  },
};

export default nextConfig;

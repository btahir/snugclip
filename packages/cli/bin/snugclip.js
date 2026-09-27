#!/usr/bin/env node
// Snugclip CLI entry point. Build first (`pnpm build`); the logic lives in src/main.ts.
import { main, nodeIo } from '../dist/main.js';

process.exitCode = await main(process.argv.slice(2), nodeIo());

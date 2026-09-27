#!/usr/bin/env node
// Snugclip MCP server over stdio. Build first (`pnpm build`).
import { startStdioServer } from '../dist/index.js';

await startStdioServer();

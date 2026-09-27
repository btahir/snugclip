#!/usr/bin/env bash
# `pnpm verify` (PLAN §11): every check in order. Light steps run directly; heavy steps go through
# ../research/heavy.sh (the wrapped scripts call it themselves). Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }
step typecheck;        pnpm typecheck
step lint;             pnpm lint
step purity;           pnpm check:pure
step licences;         pnpm licenses:check
step "unit + CLI + MCP tests"; pnpm build && ../research/heavy.sh npx vitest run
step fixtures;         pnpm fixtures
step "CLI matrix";     ../research/heavy.sh node scripts/fit-matrix.mjs
step "forced encoder"; ../research/heavy.sh bash scripts/verify/force-encoder.sh
step "engine-web browser check"; pnpm test:browser:engine
step "web build";      pnpm build:web
step "web matrix";     ../research/heavy.sh node scripts/verify/web-matrix/run.mjs
step consistency;      pnpm test:consistency
step "e2e (chrome)";   bash scripts/verify/e2e.sh --project=chrome
step lighthouse;       pnpm lighthouse
printf '\nverify: all steps passed\n'

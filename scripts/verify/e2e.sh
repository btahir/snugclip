#!/usr/bin/env bash
# Verifier Playwright runner: ../research/heavy.sh is applied here.
#   scripts/verify/e2e.sh --project=chrome [spec...]
#   VERIFY_SUITE=app scripts/verify/e2e.sh --project=firefox
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../.."
# Specs here import @playwright/test; resolve it from apps/web (gitignored symlink).
[ -e "$here/node_modules" ] || ln -s ../../apps/web/node_modules "$here/node_modules"
cd "$here"
exec "$repo/../research/heavy.sh" "$repo/apps/web/node_modules/.bin/playwright" test -c playwright.config.ts "$@"

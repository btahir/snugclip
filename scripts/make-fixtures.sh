#!/usr/bin/env bash
# PLAN §12 entry point; the generator itself is scripts/make-fixtures.mjs (portable Node, no deps).
set -euo pipefail
exec node "$(dirname "$0")/make-fixtures.mjs" "$@"

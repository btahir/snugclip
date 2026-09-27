#!/usr/bin/env bash
# Verifier: ACCEPTANCE M1. Lighthouse (default mobile config) on / and /compress-video-for-discord/
# against the production static export served locally on 4319. Run through research/heavy.sh.
#   LIGHTHOUSE=/path/to/node_modules/.bin/lighthouse scripts/verify/lighthouse.sh
set -u
repo="$(cd "$(dirname "$0")/../.." && pwd)"; LH="${LIGHTHOUSE:-npx --yes lighthouse}"; out="$repo/test-results/verify"
mkdir -p "$out"
node "$repo/apps/web/scripts/serve-static.mjs" "$repo/apps/web/out" 4319 >/dev/null 2>&1 & srv=$!
trap 'kill $srv 2>/dev/null' EXIT
sleep 1; fail=0
for p in / /compress-video-for-discord/; do
  name=$(echo "$p" | tr -c 'a-z0-9\n' '-' | sed 's/^-*$/home/;s/^-//;s/-$//'); [ -z "$name" ] && name=home
  $LH "http://127.0.0.1:4319$p" --quiet --only-categories=performance,accessibility,best-practices,seo \
    --chrome-flags="--headless=new" --output=json --output-path="$out/lighthouse-$name.json" || fail=1
  node -e 'const j=require(process.argv[1]);const s=k=>Math.round(j.categories[k].score*100);const a=j.audits;console.log(`${process.argv[2]}: performance ${s("performance")} accessibility ${s("accessibility")} best-practices ${s("best-practices")} seo ${s("seo")} | LCP ${a["largest-contentful-paint"].displayValue} TBT ${a["total-blocking-time"].displayValue} CLS ${a["cumulative-layout-shift"].displayValue} FCP ${a["first-contentful-paint"].displayValue}`);process.exit(s("performance")>=90&&s("accessibility")>=95?0:1)' "$out/lighthouse-$name.json" "$p" || fail=1
done
exit $fail

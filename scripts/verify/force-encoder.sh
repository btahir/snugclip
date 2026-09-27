#!/usr/bin/env bash
# Verifier: ACCEPTANCE C3. Forces h264_videotoolbox on F01/F03/F14 at 8 MB and 25% of size.
# Run through research/heavy.sh.
set -u
here="$(cd "$(dirname "$0")/../.." && pwd)"; B="$here/packages/cli/bin/snugclip.js"; F="$here/fixtures/generated"
out="$(mktemp -d)"; fail=0
for f in f01-testsrc2-1080p30-10s.mp4 f03-screen-1080p30-30s.mp4 f14-perf-1080p30-60s.mp4; do
  sz=$(stat -f%z "$F/$f"); q=$((sz / 4))
  for t in 8000000 $q; do
    SNUGCLIP_FORCE_ENCODER="${ENC:-h264_videotoolbox}" node "$B" compress "$F/$f" --size ${t}B --json --out-dir "$out" --overwrite > "$out/r.json"; code=$?
    node -e 'const j=require(process.argv[1]).results[0];const t=+process.argv[2];const ok=(j.status==="fit"||j.status==="passthrough")&&j.output.bytes<=t;console.log(`${ok?"ok  ":"FAIL"} ${process.argv[3]} target ${t} exit ${process.argv[4]} ${j.status} ${j.output?.bytes} encoder=${j.engine.encoder} attempts=${j.attempts.length} ssim=${j.quality?.ssimMean}`);process.exit(ok?0:1)' "$out/r.json" $t $f $code || fail=1
  done
done
rm -rf "$out"; exit $fail

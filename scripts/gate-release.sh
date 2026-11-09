#!/usr/bin/env bash
# Release gate: this checkout against the previous published version on the held-out sets (real-corpus + hub), same run,
# each on its own clone. Fails when hybrid @1 or multi @1 drops by more than the band (one question).
#   scripts/gate-release.sh [previous-version]   default: the newest published version below package.json's
# Needs `npm run build` first. Never writes into the repo.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BAND=1
cur=$(node -p "require('$REPO/package.json').version")
prev="${1:-$(npm view @theglitchking/semantic-memory versions --json | node -e '
const v=JSON.parse(require("fs").readFileSync(0,"utf8")),c=process.argv[1].split(".").map(Number);
const lt=(a)=>{a=a.split(".").map(Number);for(let i=0;i<3;i++)if(a[i]!==c[i])return a[i]<c[i];return false};
console.log(v.filter(x=>/^\d+\.\d+\.\d+$/.test(x)&&lt(x)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).pop())' "$cur")}"
echo "gate: local ($cur) vs $prev, held-out sets, band $BAND"
out=$("$REPO/scripts/eval-against-release.sh" --set "$REPO/test/retrieval-eval/real-corpus-heldout.jsonl" --set "$REPO/test/retrieval-eval/real-hub-heldout.jsonl" "$prev" local)
echo "$out"
# columns: run hyb@1 hyb@3 sem@1 multi@1 ...; hyb@1 and multi@1 are "n/total"
echo "$out" | awk -v prev="$prev" -v band="$BAND" '
  $1==prev { split($2,a,"/"); split($5,b,"/"); ph=a[1]; pm=b[1]; seen++ }
  $1=="local" { split($2,a,"/"); split($5,b,"/"); lh=a[1]; lm=b[1]; seen++ }
  END {
    if (seen != 2) { print "gate: could not parse the table" > "/dev/stderr"; exit 2 }
    printf "gate: hybrid @1 %d vs %d, multi @1 %d vs %d\n", lh, ph, lm, pm
    if (lh < ph - band || lm < pm - band) { print "gate: FAIL (drop beyond the band)"; exit 1 }
    print "gate: PASS"
  }'

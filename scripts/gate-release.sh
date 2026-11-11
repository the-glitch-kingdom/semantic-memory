#!/usr/bin/env bash
# Release gate: this checkout against the previous published version on the held-out sets (real-corpus, hub, long-section,
# long-section-hard, absent-terms, multi-hub, whole-answer, identifier-tier), same run, each on its own clone, three ways: no export, with `.hewtd/graph.json`, and with `git log`
# slowed to 30 s. Each run is measured in-process (cli) and through the stdio server (mcp). Fails when
#   - local hybrid @1 or multi @1 drops by more than the band (one question) against the previous version, on cli or mcp;
#   - multi @3 or @8, or cov@3 (by one question's share), drops by more than the band against the previous version, or dominance
#     (top-3 slots one doc takes on questions it does not answer) rises by more than the band, on the arms that report them
#     (a release before 1.24.0 reports cov and dominance only in its mcp arm);
#   - flagged negatives drop (absent-terms-heldout holds the spelling-variant negatives hn28-hn30 and controls hc23-hc27, #78), or flagged answerable questions (false flags) rise, by more than the band, on cli or mcp;
#   - local mcp and cli differ in top 3, `related` or the entity card on more than the band of questions (HNSW builds differ:
#     #78 Phase 9 failed once on 1 of 166); the differing questions are printed either way;
#   - the first local mcp answers (also with slow git) lack titles on a #1 result.
#   scripts/gate-release.sh [previous-version]   default: the newest published version below package.json's
# Needs `npm run build` first. Takes ~6 min (4 clone indexes, 8 evals), never writes into the repo.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export BAND=${BAND:-1}
cur=$(node -p "require('$REPO/package.json').version")
prev="${1:-$(npm view @theglitchking/semantic-memory versions --json | node -e '
const v=JSON.parse(require("fs").readFileSync(0,"utf8")),c=process.argv[1].split(".").map(Number);
const lt=(a)=>{a=a.split(".").map(Number);for(let i=0;i<3;i++)if(a[i]!==c[i])return a[i]<c[i];return false};
console.log(v.filter(x=>/^\d+\.\d+\.\d+$/.test(x)&&lt(x)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).pop())' "$cur")}"
echo "gate: local ($cur) vs $prev, held-out sets, band $BAND"
SETS=(); for f in real-corpus-heldout real-hub-heldout long-section-heldout long-section-hard-heldout absent-terms-heldout multi-hub-heldout whole-answer-heldout identifier-tier-heldout; do SETS+=(--set "$REPO/test/retrieval-eval/$f.jsonl"); done
T="$(mktemp -d "${TMPDIR:-/tmp}/gate-release.XXXXXX")"; trap 'rm -rf "$T"' EXIT
GATE_TMP="$T/plain" "$REPO/scripts/eval-against-release.sh" --slow-git "${SETS[@]}" "$prev" local
GATE_TMP="$T/export" "$REPO/scripts/eval-against-release.sh" --export "${SETS[@]}" "$prev" local
node - "$T" "$prev" <<'E2'
const fs = require("fs");
const [T, prev] = process.argv.slice(2), band = Number(process.env.BAND);
const load = (d, f) => (fs.existsSync(`${d}/${f}.json`) ? JSON.parse(fs.readFileSync(`${d}/${f}.json`)) : null);
const nums = (e) => {
  const h = e.arms.search_hybrid.all.tiers; const a = e.arms.search_hybrid.all, m = h.multi;
  return { hyb: h.all.at[1], multi: m?.at[1] ?? 0, m3: m?.at[3] ?? 0, m8: m?.at[8] ?? 0, cov3: a.cov?.facet[3], covStep: m?.n ? 1 / m.n : 0, dom: a.dominance?.slots, neg: e.arms.search_hybrid.all.negativesFlagged, fals: a.answerableFlagged };
};
const fails = [];
for (const [mode, sfx] of [["no export", ""], ["export", "-export"]]) {
  const p = `${T}/${mode === "export" ? "export" : "plain"}/${prev}${sfx}`, l = `${T}/${mode === "export" ? "export" : "plain"}/local${sfx}`;
  for (const arm of ["eval", "eval-mcp"]) {
    const a = nums(load(p, arm)), b = nums(load(l, arm));
    console.log(`gate: ${mode} ${arm}: hybrid @1 ${b.hyb} vs ${a.hyb}, multi @1 ${b.multi} vs ${a.multi}`);
    if (b.hyb < a.hyb - band || b.multi < a.multi - band) fails.push(`${mode} ${arm}: drop beyond the band`);
    console.log(`gate: ${mode} ${arm}: multi @3 ${b.m3} vs ${a.m3}, @8 ${b.m8} vs ${a.m8}, cov@3 ${b.cov3?.toFixed(3)} vs ${a.cov3?.toFixed(3)}, dominance ${b.dom} vs ${a.dom}`);
    if (b.m3 < a.m3 - band || b.m8 < a.m8 - band) fails.push(`${mode} ${arm}: multi @3/@8 drop beyond the band`);
    if (a.cov3 !== undefined && b.cov3 < a.cov3 - band * b.covStep) fails.push(`${mode} ${arm}: cov@3 drops beyond the band`);
    if (a.dom !== undefined && b.dom > a.dom + band) fails.push(`${mode} ${arm}: dominance rises beyond the band`);
    console.log(`gate: ${mode} ${arm}: negatives flagged ${b.neg} vs ${a.neg}, false flags ${b.fals} vs ${a.fals}`);
    if (b.neg < a.neg - band) fails.push(`${mode} ${arm}: flagged negatives drop beyond the band`);
    if (b.fals > a.fals + band) fails.push(`${mode} ${arm}: false flags rise beyond the band`);
  }
  const cli = load(l, "eval"), mcp = load(l, "eval-mcp"), slow = load(l, "eval-mcp-slow");
  const diff = Object.keys(cli.probes).filter((q) => JSON.stringify(cli.probes[q]) !== JSON.stringify(mcp.probes[q]));
  console.log(`gate: ${mode} mcp vs cli: ${diff.length} of ${Object.keys(cli.probes).length} questions differ in top 3 / related / entity`);
  for (const q of diff) console.log(`gate:   differs: ${q}`);
  if (diff.length > band) fails.push(`${mode}: mcp differs from cli on ${diff.length} questions, e.g. "${diff[0]}"`);
  for (const [name, e] of [["mcp", mcp], ["mcp-slow", slow]]) {
    if (!e) continue;
    console.log(`gate: ${mode} ${name}: titled #1 ${e.mcp.top1With.titled}/${e.mcp.questions}, first answer ${Math.round(e.mcp.firstAnswerMs)}ms`);
    if (e.mcp.top1With.titled < e.mcp.questions) fails.push(`${mode} ${name}: ${e.mcp.questions - e.mcp.top1With.titled} first answers lack titles`);
  }
}
if (fails.length) { console.log("gate: FAIL\n  " + fails.join("\n  ")); process.exit(1); }
console.log("gate: PASS");
E2

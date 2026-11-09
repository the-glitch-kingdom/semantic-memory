#!/usr/bin/env bash
# Same-run retrieval comparison of published packages against this checkout, each on its own `git clone --local` of the repo
# (code and history present, so grounding runs). Never writes into the repo; temp dirs are removed on exit.
#
#   scripts/eval-against-release.sh [--export] [--docs-only] [--set <file.jsonl>]... <version|local>...
#
#   <version>   a published @theglitchking/semantic-memory version (npm pack), e.g. 1.15.0
#   local       this checkout's dist/ (run `npm run build` first)
#   --docs-only measure on a copy of .documentation alone, as the in-repo real-corpus eval does (no code, so no grounding)
#   --export    run `hewtd index` in each clone first, so .hewtd/graph.json exists (default: no export)
#   --set       question sets (default: real-corpus + real-corpus-heldout + real-hub + real-hub-heldout)
#
# Prints one table: hybrid / semantic @1, @3, multi @1, #1+related, related per #1, negatives flagged, p95, per set group;
# then the stdio-launch probe (fields on #1, entity cards). Set GATE_TMP to reuse a directory (it is not removed).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT=0; DOCS_ONLY=0; SETS=(); VERSIONS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --export) EXPORT=1 ;;
    --docs-only) DOCS_ONLY=1 ;;
    --set) SETS+=("$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); shift ;;
    -h|--help) sed -n 2,15p "$0"; exit 0 ;;
    *) VERSIONS+=("$1") ;;
  esac
  shift
done
[ ${#VERSIONS[@]} -gt 0 ] || { echo "usage: $0 [--export] [--docs-only] [--set file]... <version|local>..." >&2; exit 2; }
if [ ${#SETS[@]} -eq 0 ]; then
  for f in real-corpus real-corpus-heldout real-hub real-hub-heldout; do SETS+=("$REPO/test/retrieval-eval/$f.jsonl"); done
fi

if [ -n "${GATE_TMP:-}" ]; then T="$GATE_TMP"; mkdir -p "$T"; else T="$(mktemp -d "${TMPDIR:-/tmp}/eval-release.XXXXXX")"; trap 'rm -rf "$T"' EXIT; fi

for v in "${VERSIONS[@]}"; do
  sfx=""; if [ $EXPORT = 1 ]; then sfx="-export"; fi
  d="$T/$v$sfx"; mkdir -p "$d"
  if [ "$v" = local ]; then pkg="$REPO"
  else
    pkg="$T/pkg-$v"
    if [ ! -d "$pkg/package" ]; then
      mkdir -p "$pkg" && (cd "$pkg" && npm pack -q "@theglitchking/semantic-memory@$v" >/dev/null && tar xzf ./*.tgz)
      ln -s "$REPO/node_modules" "$pkg/package/node_modules"
    fi
    pkg="$pkg/package"
  fi
  [ -f "$pkg/dist/cli/index.js" ] || { echo "$v: no dist/ (run npm run build)" >&2; exit 1; }
  if [ $DOCS_ONLY = 1 ]; then mkdir "$d/tree" && cp -r "$REPO/.documentation" "$d/tree/"; else git clone -q --local "$REPO" "$d/tree"; fi
  # the clone holds the committed tree: the sets under test come from the checkout, not the clone
  if [ $EXPORT = 1 ]; then (cd "$d/tree" && "$REPO/node_modules/.bin/hewtd" index >/dev/null 2>&1); fi
  t0=$(date +%s.%N)
  (cd "$d/tree" && timeout 1200 node "$pkg/dist/cli/index.js" --notes .documentation --reindex </dev/null >"$d/index.log" 2>&1)
  echo "$(date +%s.%N) $t0" | awk '{printf "%.1f", $1 - $2}' >"$d/index.sec"
  (cd "$d/tree" && node "$pkg/dist/cli/index.js" eval --notes .documentation --set "${SETS[@]}" --dir "$d/eval-out" --json >"$d/eval.json" 2>"$d/eval.err") || { echo "$v: eval failed:" >&2; tail -3 "$d/eval.err" >&2; exit 1; }
  node "$REPO/scripts/lib/eval-probe.mjs" "$pkg" "$d/tree" "${SETS[@]}" >"$d/probe.json"
  echo "$d" >>"$T/order"
done

node - "$T" <<'E2'
const fs = require("fs");
const dirs = fs.readFileSync(process.argv[2] + "/order", "utf8").trim().split("\n");
const rows = [];
for (const d of dirs) {
  const e = JSON.parse(fs.readFileSync(d + "/eval.json")), p = JSON.parse(fs.readFileSync(d + "/probe.json"));
  const h = e.arms.search_hybrid.all, s = e.arms.search_semantic.all, all = h.tiers.all, multi = h.tiers.multi ?? { at: {}, n: 0 };
  rows.push([d.split("/").pop(), `${all.at[1]}/${all.n}`, all.at[3], `${s.tiers.all.at[1]}/${s.tiers.all.n}`, `${multi.at[1] ?? 0}/${multi.n}`, all.expandedAt1, p.relatedPerTop, `${h.negativesFlagged}/${h.negativeTop.length}`, Math.round(h.latencyMs.p95) + "ms", fs.readFileSync(d + "/index.sec", "utf8") + "s", Object.values(p.entityCard).filter(Boolean).length + "/" + Object.keys(p.entityCard).length, Object.entries(p.top1WithField).map(([k, v]) => `${k}:${v}`).join(" ")]);
}
const head = ["run", "hyb@1", "hyb@3", "sem@1", "multi@1", "#1+rel", "rel/#1", "neg flagged", "p95", "cold idx", "cards", "#1 fields (of answerable)"];
const w = head.map((x, i) => Math.max(x.length, ...rows.map((r) => String(r[i]).length)));
const line = (r) => r.map((x, i) => String(x).padEnd(w[i])).join("  ");
console.log([line(head), ...rows.map(line)].join("\n"));
E2

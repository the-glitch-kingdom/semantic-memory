#!/usr/bin/env bash
# Same-run retrieval comparison of published packages against this checkout, each on its own `git clone --local` of the repo
# (code and history present, so grounding runs). Never writes into the repo; temp dirs are removed on exit.
#
#   scripts/eval-against-release.sh [--export] [--docs-only] [--set <file.jsonl>]... <version|local>...
#
#   <version>   a published @theglitchking/semantic-memory version (npm pack), e.g. 1.15.0
#   local       this checkout's dist/ (run `npm run build` first)
#   --docs-only measure on a copy of .documentation alone, as the in-repo real-corpus eval does (no code, so no grounding)
#   --slow-git  a third arm, `mcp-slow`: the same server with `git log` taking 30 s, queried at once (the doc-metadata load gap of #73)
#   --export    run `hewtd index` in each clone first, so .hewtd/graph.json exists (default: no export)
#   --set       question sets (default: real-corpus + real-corpus-heldout + real-hub + real-hub-heldout)
#
# Each run is measured twice, on the same index: `eval` (in-process) and `eval --via mcp --settle` (the stdio server as the plugin
# launches it, queried as soon as it answers, answers marked stale retried until the code graph has landed). Prints one table, a row per run and arm: hybrid / semantic @1, @3, multi @1, #1+related,
# related per #1, negatives flagged, p95, then for the mcp arm the first-answer time, entity cards and fields on #1.
# A set named long-section*.jsonl or multi-hub*.jsonl also copies its fixture dir (test/fixtures/long-section/, long-section-hard/ or multi-hub/) into each clone's .documentation first.
# multi@1/@3/@8, cov (mean facet coverage of the multi questions at @1/@3/@8) and dom (most top-3 slots one doc takes) come from the report's own metrics: a release before 1.24.0 has no cov/dom in its own `cli` arm (shown as -), but the `mcp` arm is driven by this checkout, so it has them for every version.
# Set GATE_TMP to reuse a directory (it is not removed).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT=0; DOCS_ONLY=0; SLOW=0; SETS=(); VERSIONS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --export) EXPORT=1 ;;
    --docs-only) DOCS_ONLY=1 ;;
    --slow-git) SLOW=1 ;;
    --set) SETS+=("$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); shift ;;
    -h|--help) sed -n 2,20p "$0"; exit 0 ;;
    *) VERSIONS+=("$1") ;;
  esac
  shift
done
[ ${#VERSIONS[@]} -gt 0 ] || { echo "usage: $0 [--export] [--docs-only] [--slow-git] [--set file]... <version|local>..." >&2; exit 2; }
if [ ${#SETS[@]} -eq 0 ]; then
  for f in real-corpus real-corpus-heldout real-hub real-hub-heldout long-section long-section-heldout; do SETS+=("$REPO/test/retrieval-eval/$f.jsonl"); done
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
  for fx in long-section long-section-hard multi-hub; do
    case " ${SETS[*]} " in *"/$fx.jsonl"*|*"/$fx-heldout.jsonl"*) mkdir -p "$d/tree/.documentation/$fx" && cp "$REPO"/test/fixtures/$fx/*.md "$d/tree/.documentation/$fx/" ;; esac
  done
  # the clone holds the committed tree: the sets under test come from the checkout, not the clone
  if [ $EXPORT = 1 ]; then (cd "$d/tree" && "$REPO/node_modules/.bin/hewtd" index >/dev/null 2>&1); fi
  t0=$(date +%s.%N)
  (cd "$d/tree" && timeout 1200 node "$pkg/dist/cli/index.js" --notes .documentation --reindex </dev/null >"$d/index.log" 2>&1)
  echo "$(date +%s.%N) $t0" | awk '{printf "%.1f", $1 - $2}' >"$d/index.sec"
  (cd "$d/tree" && node "$pkg/dist/cli/index.js" eval --notes .documentation --set "${SETS[@]}" --dir "$d/eval-out" --json >"$d/eval.json" 2>"$d/eval.err") || { echo "$v: eval failed:" >&2; tail -3 "$d/eval.err" >&2; exit 1; }
  # this checkout drives, `pkg` is the server under test; the retry in the client covers releases that answer "Indexing in progress" first
  (cd "$d/tree" && node "$REPO/dist/cli/index.js" eval --notes .documentation --via mcp --settle --server "$pkg/dist/cli/index.js" --cwd . --set "${SETS[@]}" --dir "$d/eval-out" --json >"$d/eval-mcp.json" 2>"$d/eval-mcp.err") || { echo "$v: eval --via mcp failed:" >&2; tail -3 "$d/eval-mcp.err" >&2; exit 1; }
  if [ $SLOW = 1 ]; then
    shim="$T/git-shim"; mkdir -p "$shim"
    printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = log ] && sleep 30 && break; done\nexec %s "$@"\n' "$(command -v git)" >"$shim/git"; chmod +x "$shim/git"
    (cd "$d/tree" && PATH="$shim:$PATH" node "$REPO/dist/cli/index.js" eval --notes .documentation --via mcp --server "$pkg/dist/cli/index.js" --cwd . --set "${SETS[@]}" --dir "$d/eval-out" --json >"$d/eval-mcp-slow.json" 2>"$d/eval-mcp-slow.err") || { echo "$v: slow-git eval failed:" >&2; tail -3 "$d/eval-mcp-slow.err" >&2; exit 1; }
  fi
  echo "$d" >>"$T/order"
done

node - "$T" <<'E2'
const fs = require("fs");
const dirs = fs.readFileSync(process.argv[2] + "/order", "utf8").trim().split("\n");
const rows = [];
for (const d of dirs) {
  const idx = fs.readFileSync(d + "/index.sec", "utf8") + "s";
  for (const [arm, file] of [["cli", "eval"], ["mcp", "eval-mcp"], ["mcp-slow", "eval-mcp-slow"]]) {
    if (!fs.existsSync(`${d}/${file}.json`)) continue;
    const e = JSON.parse(fs.readFileSync(`${d}/${file}.json`)), m = e.mcp;
    const h = e.arms.search_hybrid.all, s = e.arms.search_semantic.all, all = h.tiers.all, multi = h.tiers.multi ?? { at: {}, n: 0 }, cov = h.cov?.facet, dom = h.dominance;
    rows.push([d.split("/").pop() + " " + arm, `${all.at[1]}/${all.n}`, all.at[3], `${s.tiers.all.at[1]}/${s.tiers.all.n}`, `${multi.at[1] ?? 0}/${multi.at[3] ?? 0}/${multi.at[8] ?? 0} of ${multi.n}`, cov ? [1, 3, 8].map((k) => cov[k].toFixed(2)).join("/") : "-", dom ? String(dom.slots) : "-", (all.expandedAt1 ?? 0), (h.relatedPerTop ?? 0).toFixed(2), `${h.negativesFlagged}/${h.negativeTop.length}`, Math.round(h.latencyMs.p95) + "ms", idx,
      m ? Math.round(m.firstAnswerMs) + "ms" : "", m ? Object.values(m.entityCard).filter(Boolean).length + "/" + Object.keys(m.entityCard).length : "", m ? Object.entries(m.top1With).map(([k, v]) => `${k}:${v}`).join(" ") + ` (of ${m.questions})` : ""]);
  }
}
const head = ["run", "hyb@1", "hyb@3", "sem@1", "multi@1/3/8", "cov@1/3/8", "dom", "#1+rel", "rel/#1", "neg flagged", "p95", "cold idx", "1st answer", "cards", "#1 fields (mcp)"];
const w = head.map((x, i) => Math.max(x.length, ...rows.map((r) => String(r[i]).length)));
const line = (r) => r.map((x, i) => String(x).padEnd(w[i])).join("  ");
console.log([line(head), ...rows.map(line)].join("\n"));
E2

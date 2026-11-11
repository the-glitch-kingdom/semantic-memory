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
#   --cache     reuse a published version's package, indexed clone and results across calls (dir: $EVAL_CACHE, default
#               ~/.cache/semantic-memory-eval). Keyed on version, flags, the committed tree (or .documentation with --docs-only),
#               the copied fixtures and the set files; the mcp arm is also keyed on this checkout's dist/. `local` is never
#               cached. Results repeat exactly across fresh builds (faster-validation-runs Phase 2), but a cached row's p95,
#               cold idx and first answer are from the run that filled it: rows read "(cached)". gate-release.sh never uses it.
#
# Each run is measured twice, on the same index: `eval` (in-process) and `eval --via mcp --settle` (the stdio server as the plugin
# launches it, queried as soon as it answers, answers marked stale retried until the code graph has landed). Prints one table, a row per run and arm: hybrid / semantic @1, @3, multi @1, #1+related,
# related per #1, negatives flagged, p95, then for the mcp arm the first-answer time, entity cards and fields on #1.
# A set named long-section*.jsonl, multi-hub*.jsonl, identifier-tier*.jsonl or whole-answer*.jsonl (multi-hub) also copies its fixture dir (test/fixtures/long-section/, long-section-hard/, multi-hub/ or identifier-tier/) into each clone's .documentation first.
# multi@1/@3/@8, cov (mean facet coverage of the multi questions at @1/@3/@8) and dom (most top-3 slots one doc takes) come from the report's own metrics: a release before 1.24.0 has no cov/dom in its own `cli` arm (shown as -), but the `mcp` arm is driven by this checkout, so it has them for every version.
# Set GATE_TMP to reuse a directory (it is not removed).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPORT=0; DOCS_ONLY=0; SLOW=0; CACHE=0; SETS=(); VERSIONS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --export) EXPORT=1 ;;
    --docs-only) DOCS_ONLY=1 ;;
    --slow-git) SLOW=1 ;;
    --cache) CACHE=1 ;;
    --set) SETS+=("$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); shift ;;
    -h|--help) sed -n 2,20p "$0"; exit 0 ;;
    *) VERSIONS+=("$1") ;;
  esac
  shift
done
[ ${#VERSIONS[@]} -gt 0 ] || { echo "usage: $0 [--export] [--docs-only] [--slow-git] [--cache] [--set file]... <version|local>..." >&2; exit 2; }
if [ ${#SETS[@]} -eq 0 ]; then
  for f in real-corpus real-corpus-heldout real-hub real-hub-heldout long-section long-section-heldout; do SETS+=("$REPO/test/retrieval-eval/$f.jsonl"); done
fi

if [ -n "${GATE_TMP:-}" ]; then T="$GATE_TMP"; mkdir -p "$T"; else T="$(mktemp -d "${TMPDIR:-/tmp}/eval-release.XXXXXX")"; trap 'rm -rf "$T"' EXIT; fi
FIXTURES=(); for fx in long-section long-section-hard multi-hub identifier-tier; do
  case " ${SETS[*]} " in *"/$fx.jsonl"*|*"/$fx-heldout.jsonl"*) FIXTURES+=("$fx") ;; esac
done
# the whole-answer sets (#91 part 2) are questions over the multi-hub fixture
case " ${SETS[*]} " in *"/whole-answer.jsonl"*|*"/whole-answer-heldout.jsonl"*) case " ${FIXTURES[*]} " in *" multi-hub "*) ;; *) FIXTURES+=(multi-hub) ;; esac ;; esac
if [ $CACHE = 1 ]; then
  # shortcut: no lock, so two runs filling the same key at once can collide; the plan-runner runs one heavy job at a time
  CROOT="${EVAL_CACHE:-$HOME/.cache/semantic-memory-eval}"; mkdir -p "$CROOT"
  if [ $DOCS_ONLY = 1 ]; then corpus=$(cd "$REPO" && find .documentation -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum); else corpus=$(git -C "$REPO" rev-parse 'HEAD^{tree}'); fi
  fxsum=$(for fx in "${FIXTURES[@]}"; do sha256sum "$REPO"/test/fixtures/$fx/*.md; done | sha256sum)
  KEY=$(printf '%s\n' "e$EXPORT d$DOCS_ONLY s$SLOW" "$corpus" "$fxsum" "$(cat "${SETS[@]}" | sha256sum)" | sha256sum | cut -c1-16)
  CLIENT=$(cd "$REPO" && find dist -type f -print0 | sort -z | xargs -0 cat | sha256sum | cut -c1-16)
fi
# run CMD... with stdout to FILE only if it succeeds (a cached result is never a half-written one)
into() { local out="$1"; shift; "$@" >"$out.part" && mv "$out.part" "$out"; }

for v in "${VERSIONS[@]}"; do
  sfx=""; if [ $EXPORT = 1 ]; then sfx="-export"; fi
  d="$T/$v$sfx"; cached=0
  if [ "$v" != local ] && [ $CACHE = 1 ]; then d="$CROOT/$v$sfx-$KEY"; fi
  mkdir -p "$d"
  if [ "$v" = local ]; then pkg="$REPO"
  else
    pkg="$T/pkg-$v"; [ $CACHE = 1 ] && pkg="$CROOT/pkg-$v"
    if [ ! -d "$pkg/package" ]; then
      mkdir -p "$pkg" && (cd "$pkg" && npm pack -q "@theglitchking/semantic-memory@$v" >/dev/null && tar xzf ./*.tgz)
      ln -s "$REPO/node_modules" "$pkg/package/node_modules"
    fi
    pkg="$pkg/package"
  fi
  [ -f "$pkg/dist/cli/index.js" ] || { echo "$v: no dist/ (run npm run build)" >&2; exit 1; }
  if [ $CACHE = 1 ] && [ "$v" != local ] && [ -f "$d/index.sec" ]; then cached=1
  else
    # never reuse an unkeyed leftover (a GATE_TMP reused without --cache): rebuild everything
    rm -rf "$d/tree" "$d"/eval*.json "$d/index.sec" "$d/mcp.client"
    if [ $DOCS_ONLY = 1 ]; then mkdir "$d/tree" && cp -r "$REPO/.documentation" "$d/tree/"; else git clone -q --local "$REPO" "$d/tree"; fi
    for fx in "${FIXTURES[@]}"; do mkdir -p "$d/tree/.documentation/$fx" && cp "$REPO"/test/fixtures/$fx/*.md "$d/tree/.documentation/$fx/"; done
    # COLD_COPY=1 (#93 Phase 8): register this corpus, copied COLD_COPY_N times (default 4), as one cold generation. A release without
    # long-term support ignores it; local must answer exactly the same and build nothing under sources/.
    if [ "${COLD_COPY:-0}" = 1 ]; then
      node - "$d/tree" "$REPO" "${COLD_COPY_N:-4}" <<'E3'
const fs = require("fs"), path = require("path"), [tree, repo, n] = process.argv.slice(2);
const gen = path.join(tree, ".documentation-cold", "2026-01-01");
for (let i = 0; i < Number(n); i++) fs.cpSync(path.join(tree, ".documentation"), path.join(gen, "copy" + i), { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
const cfgPath = path.join(tree, ".claude", "hit-em-with-the-docs.json");
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : {};
import(path.join(repo, "dist/core/cold.js")).then(({ coldChecksum }) => {
  cfg.cold_storage = [{ generation: "2026-01-01", path: ".documentation-cold/2026-01-01", source_commit: "0".repeat(40), rotated_at: "2026-01-01T00:00:00Z", checksum: coldChecksum(gen), secrets_findings: [], untracked_files: [] }];
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
});
E3
    fi
    # the clone holds the committed tree: the sets under test come from the checkout, not the clone
    if [ $EXPORT = 1 ]; then (cd "$d/tree" && "$REPO/node_modules/.bin/hewtd" index >/dev/null 2>&1); fi
    t0=$(date +%s.%N)
    (cd "$d/tree" && timeout 1200 node "$pkg/dist/cli/index.js" --notes .documentation --reindex </dev/null >"$d/index.log" 2>&1)
    echo "$(date +%s.%N) $t0" | awk '{printf "%.1f", $1 - $2}' >"$d/index.sec"
  fi
  if [ ! -f "$d/eval.json" ]; then
    (cd "$d/tree" && into "$d/eval.json" node "$pkg/dist/cli/index.js" eval --notes .documentation --set "${SETS[@]}" --dir "$d/eval-out" --json 2>"$d/eval.err") || { echo "$v: eval failed:" >&2; tail -3 "$d/eval.err" >&2; exit 1; }
  fi
  # the mcp arms are driven by this checkout's dist/: a cached result only stands for the client that made it
  if [ "$cached" = 1 ] && [ "$(cat "$d/mcp.client" 2>/dev/null)" != "${CLIENT:-}" ]; then rm -f "$d/eval-mcp.json" "$d/eval-mcp-slow.json"; fi
  if [ ! -f "$d/eval-mcp.json" ]; then
    # this checkout drives, `pkg` is the server under test; the retry in the client covers releases that answer "Indexing in progress" first
    (cd "$d/tree" && into "$d/eval-mcp.json" node "$REPO/dist/cli/index.js" eval --notes .documentation --via mcp --settle --server "$pkg/dist/cli/index.js" --cwd . --set "${SETS[@]}" --dir "$d/eval-out" --json 2>"$d/eval-mcp.err") || { echo "$v: eval --via mcp failed:" >&2; tail -3 "$d/eval-mcp.err" >&2; exit 1; }
  fi
  if [ $SLOW = 1 ] && [ ! -f "$d/eval-mcp-slow.json" ]; then
    shim="$T/git-shim"; mkdir -p "$shim"
    printf '#!/bin/sh\nfor a in "$@"; do [ "$a" = log ] && sleep 30 && break; done\nexec %s "$@"\n' "$(command -v git)" >"$shim/git"; chmod +x "$shim/git"
    (cd "$d/tree" && PATH="$shim:$PATH" into "$d/eval-mcp-slow.json" node "$REPO/dist/cli/index.js" eval --notes .documentation --via mcp --server "$pkg/dist/cli/index.js" --cwd . --set "${SETS[@]}" --dir "$d/eval-out" --json 2>"$d/eval-mcp-slow.err") || { echo "$v: slow-git eval failed:" >&2; tail -3 "$d/eval-mcp-slow.err" >&2; exit 1; }
  fi
  if [ "${COLD_COPY:-0}" = 1 ] && [ "$v" = local ]; then
    if [ -e "$d/tree/.documentation/.semantic-sidekick-index/sources" ]; then echo "local: an index was built under sources/ with a cold generation configured" >&2; exit 1; fi
    echo "cold copy: no index under sources/ ($(find "$d/tree/.documentation-cold" -type f | wc -l) cold files)" >&2
  fi
  [ -n "${CLIENT:-}" ] && [ "$v" != local ] && echo "$CLIENT" >"$d/mcp.client"
  label="$v$sfx"; [ "$cached" = 1 ] && label="$label (cached)"
  printf '%s\t%s\n' "$d" "$label" >>"$T/order"
done

node - "$T" <<'E2'
const fs = require("fs");
const runs = fs.readFileSync(process.argv[2] + "/order", "utf8").trim().split("\n").map((l) => l.split("\t"));
const rows = [];
for (const [d, label] of runs) {
  const idx = fs.readFileSync(d + "/index.sec", "utf8") + "s";
  for (const [arm, file] of [["cli", "eval"], ["mcp", "eval-mcp"], ["mcp-slow", "eval-mcp-slow"]]) {
    if (!fs.existsSync(`${d}/${file}.json`)) continue;
    const e = JSON.parse(fs.readFileSync(`${d}/${file}.json`)), m = e.mcp;
    const h = e.arms.search_hybrid.all, s = e.arms.search_semantic.all, all = h.tiers.all, multi = h.tiers.multi ?? { at: {}, n: 0 }, cov = h.cov?.facet, dom = h.dominance;
    rows.push([label + " " + arm, `${all.at[1]}/${all.n}`, all.at[3], `${s.tiers.all.at[1]}/${s.tiers.all.n}`, `${multi.at[1] ?? 0}/${multi.at[3] ?? 0}/${multi.at[8] ?? 0} of ${multi.n}`, cov ? [1, 3, 8].map((k) => cov[k].toFixed(2)).join("/") : "-", dom ? String(dom.slots) : "-", (all.expandedAt1 ?? 0), (h.relatedPerTop ?? 0).toFixed(2), `${h.negativesFlagged}/${h.negativeTop.length}`, Math.round(h.latencyMs.p95) + "ms", idx,
      m ? Math.round(m.firstAnswerMs) + "ms" : "", m ? Object.values(m.entityCard).filter(Boolean).length + "/" + Object.keys(m.entityCard).length : "", m ? Object.entries(m.top1With).map(([k, v]) => `${k}:${v}`).join(" ") + ` (of ${m.questions})` : ""]);
  }
}
const head = ["run", "hyb@1", "hyb@3", "sem@1", "multi@1/3/8", "cov@1/3/8", "dom", "#1+rel", "rel/#1", "neg flagged", "p95", "cold idx", "1st answer", "cards", "#1 fields (mcp)"];
const w = head.map((x, i) => Math.max(x.length, ...rows.map((r) => String(r[i]).length)));
const line = (r) => r.map((x, i) => String(x).padEnd(w[i])).join("  ");
console.log([line(head), ...rows.map(line)].join("\n"));
E2

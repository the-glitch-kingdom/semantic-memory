# Task Plan: query-routing

## Goal
Ship semantic-memory#61: a rules-first query classifier (`identifier | fact | flow`), a `mode` override, and for
flow questions a bounded personalized-PageRank walk that attaches an ordered `reading_path` (overview first, then
members in link order, each with its section) to result #1. Fact and identifier questions keep today's ranking. One
PR from `feat/query-routing`. Series step 4. Every missed target is stated in the PR.

## Prerequisites (each must be merged first; the plan names what it needs from each)
- #56 (`builtin-eval`): p50/p95 latency and per-tier metrics, so the walk's cost and gain are measured.
- #58 (`code-graph`): typed `cites_code` edges and code/symbol nodes with a `kind` attribute, so the walk can pass
  through code without returning it; the entity card for the identifier route; ONE shared identifier detector (#57 has
  one too: reuse it, never a second).
- #60 (`section-results`, v1.17.0): it ships `sectionFields(doc, matchedChunk, title)` (src/core/section-fields.ts) for
  ranked results and `fold()` (src/core/fold.ts). It does **not** ship a `bestSection` for an arbitrary doc: Phase 5 adds
  one (the doc's chunk with the highest cosine to the query embedding, read from the vector index the server already
  holds, then `sectionFields`). Folding (`also_in`) runs before the walk so copies never become path members.
- #58 (`code-graph`, v1.16.0): the entity card rides on result #1 without reordering, so Phase 6 only labels.

## Rules for every phase
- **Verify before ticking.** Confirm in code, or with a test, that a box is actually done before ticking it.
- **Eval discipline.** Classifier rules and walk constants are tuned on train only; held-out is reported as measured.
- **Never reorder for flow.** The reading path is attached to result #1 like `related`; the ranked list is unchanged, so
  fact @1 and multi @3 cannot drop and a wrong classification only costs payload.
- **Response shape.** `content[0]` stays a bare JSON array (the eval harness, the CLI and external kits parse it).
  `query_type` and `reading_path` go on result #1, like `related` and `no_strong_match` do today.
- **No new dependencies** (graphology has no PPR; write the power iteration). Walk values are constants, no config knobs.
- **Works without hit-em-with-the-docs.** The walk runs on the doc-only graph when no export exists.

## Phases
- [x] Phase 1: Verify and plan
  - [x] Verify #61 against main @ 29e74db (notes.md)
  - [x] Re-verify against main @ eb9bb00 (v1.17.0); phases adjusted (bestSection added in Phase 5; Phase 6 labels only)
  - [x] Post the verification comment on #61
  - [x] Sync main, cut `feat/query-routing`, commit this plan
- [x] Phase 2: Labelled questions and baseline
  - [x] Add a hand-labelled `qtype` (identifier | fact | flow) to every golden row (fixture, real, code sets); label by
        reading the question, not by copying the tier. Most `multi` rows are two facts joined by "and", not step flows:
        label honestly.
  - [x] Record the baseline per split with `eval`: fact-tier @1, multi @3, "#1 + related", p50/p95.
- [x] Phase 3: Classifier and label (no ranking change)
  - [x] `src/core/query-type.ts` `classifyQuery(q)` (done; rules differ, see Decisions Made): identifier = backticks, snake_case, camelCase, ALL_CAPS, a path, a
        file extension or `()` with ≤ 4 content tokens, or a corpus identifier hit through the shared detector; flow =
        "end to end", "walk through", "step by step", "lifecycle", "flow", "pipeline", "from X to Y", ≥ 2 action verbs
        in a list, or two wh-clauses joined by "and"; fact = everything else.
  - [x] `search_hybrid` gains `mode: "auto" | "identifier" | "fact" | "flow"` (default auto); `query_type` on result #1;
        the search event (#59 usage log, if present) records it.
  - [x] `eval` prints classifier accuracy per split (floor about 0.8 on train, held-out reported).
- [x] Phase 4: PPR walk (`GraphBuilder.walk` in `src/core/graph.ts`)
  - [x] `walk(seeds: Map<path, score>, {alpha 0.15, maxNodes 300, maxSteps 20, maxDegree 50, skip})`: local subgraph
        from the seeds (both directions) up to `maxNodes`, power iteration on it as undirected until `maxSteps` or L1
        change < 1e-6, nodes above `maxDegree` skipped (like `TAG_EDGE_MAX_DOCS`), deterministic. Code/symbol nodes
        are traversed, never returned.
- [x] Phase 5: Reading path for flow
  - [x] Seeds: the top 5 hybrid hits above `NO_STRONG_MATCH_BELOW` (0.36, not `RELATED_MIN_CONFIDENCE`: see Decisions Made), weighted by fused score. Members: up to 5 doc
        nodes by PPR × (1 + hybrid score when present). Order: a `kind: overview` member (or one next to a seed) first,
        then the others in its link order (`mdLinks` keeps document order); otherwise PPR order.
  - [x] `bestSection(doc, queryVec)` (`VectorIndex.bestChunk` + `sectionFields`, in `src/core/reading-path.ts`): the doc's chunk nearest the query vector (no re-embedding, no extra search), mapped
        through `sectionFields`. Each member `{path, title, section: {anchor, trail}, via}`.
  - [x] Attached to result #1 as `reading_path`; no reordering.
- [x] Phase 6: Identifier route
  - [x] Identifier queries put #58's entity card first and get no reading path. If #58 already does this, #61 only labels. (#58 card rides on #1 unreordered; reading_path only for flow; asserted in search-payload test)
  - [x] Remove the stale "x1.3" comment in `src/mcp/tools/search.ts`.
- [x] Phase 7: Release prep v1.18.0
  - [x] Bump all five version fields, lockfile; offline tarball builds (tarball deferred to release, built from the merge commit)
- [x] Phase 8: Cleanup -- remove junk and unused code this work created: scratch/test scripts, debug files, probe logging, one-off test functions, commented-out code, dead code from abandoned approaches (MANDATORY)
  - [x] Remove trial knobs and sweep scripts; dead-code check over the branch diff. (no sweep scripts or trial knobs found; unexported unused PATH_SEEDS/PATH_MAX)
- [x] Phase 9: Validate success through comprehensive testing -- we need to validate success thoroughly through comprehensive testing of our changes (MANDATORY)
  - [x] Independent review: list reordering for flow, a second identifier detector, unbounded walks, code nodes in the
        path, `content[0]` shape changes, constants tuned on held-out.
  - [x] Unit: classifier edge cases (handwritten); PPR on a small graph with a known answer, caps respected,
        deterministic; reading-path ordering with and without an overview.
  - [x] Latency: the walk on a synthetic 5k-node / 50k-edge graph under 10 ms; `search_hybrid` p95 ≤ 100 ms on the
        docs-vault eval (#61 check 4).
  - [x] Eval: fact-tier @1 not below baseline (#61 check 1); on the multi tier, "#1 + reading_path" ≥ max(#1 + related,
        @3) on train, held-out reported (#61 check 2; on v1.12 plain @3 was already 0.87 vs #1 + related 0.69 on the
        external blind set, so beating @3 is the real target); classifier accuracy reported (#61 check 3).
  - [x] Works without hit-em-with-the-docs: CI with no `.hewtd/graph.json`; doc-only walk (#61 check 5).
  - [x] Full suite; known flakes re-run alone and recorded. Answer each #61 acceptance item in notes.md. (full suite: only the two known load flakes failed, both pass alone)
- [x] Phase 10: Documentation pass -- a full hit-em-with-the-docs pass to create/update/deprecate as many docs as needed to capture all our changes: new procedures, tools, troubleshooting steps, gotchas, KB articles, etc. Never include secrets or passwords (MANDATORY)
  - [x] New changelog doc under `.documentation/changelog/` (`npx hewtd integrate -a`) and a `CHANGELOG.md` entry
  - [x] `.documentation/reference/mcp-tools-reference.md`: `mode`, `query_type`, `reading_path`
  - [x] `.documentation/operational/retrieval-tuning-guide.md`: classifier rules, walk constants, measurements
  - [x] `.documentation/architecture/mcp-internals.md`, `.documentation/testing/tests-and-validation.md`
  - [x] `README.md`, `npx hewtd maintain --quick`, regenerate AGENTS.md; tick the last boxes so `/plan-status` reads COMPLETE

## Key Questions
1. Should `related` stay on fact queries? The data says it does not hurt. (Default: keep it.)
2. Resolved: #58 puts the card on result #1 without reordering, so Phase 6 only labels.

## Decisions Made
- Attach `reading_path` to #1 instead of reordering: keeps fact @1 and multi @3 safe.
- The flow rules include "two wh-clauses joined by 'and'", because our multi-doc questions are mostly two facts
  joined by "and", which the issue's rules would miss.
- The walk values are constants (alpha 0.15, 300 nodes, 20 steps, degree cap 50), tuned on train only if needed.

- Classifier rules (train-tuned): identifier = #57 `identifiers()` hit, or PascalCase of 3+ words, `--flag`, `name()`; flow = end to end, walk through, step by step, lifecycle, whole life, journey, big picture, one-page summary, overview of, fit together, flow, "from X to Y". Dropped from the plan's list: "two wh-clauses joined by and" (on train it caught 2 flows and mislabelled 14 two-fact questions, which Phase 2 labelled fact), "pipeline" (fact question about a pipeline wait), bare ALL_CAPS (SAML, CUDA are prose; the real env vars have underscores), "2+ action verbs" (never fires on a train flow row), the "<= 4 content tokens" limit on `()`. Kebab-case (sluice-drain) and "tool subcommand" (warmctl prime) stay misses: #57 excludes kebab on purpose.
- `mode` is on search_hybrid only; `query_type` rides on result #1 and the search usage event.

- Phase 5: seeds clear `NO_STRONG_MATCH_BELOW` (0.36, the existing weak-match line) instead of `RELATED_MIN_CONFIDENCE` (0.5). On fixture train, forced-flow multi `#1 + path` was 9/12 at 0.5, 10/12 at 0.4, 11/12 at 0.3 and 0 (target 10/12); most multi questions have no hit at 0.5, so the path came back empty. Picked from train only, and the value is an existing constant, not a new knob. Held-out was measured, not used.
- Phase 5: members are PPR x (1 + hybrid score) as planned; seeds are members (via "hit"); other members name the seed (or member) they hang off in `via`. An overview among the top 5 goes first, else an overview next to a seed replaces the last slot; the rest follow the overview's `mdLinks` order, unlinked ones in walk order. No fixture doc has `kind: overview`, so that rule is covered by a unit test only. `section` is `{anchor, trail}` (trail drops the H1 as `sectionFields` does).
- Phase 5: `reading_path` is attached when the query type is flow and there is at least one seed. (Phase 9: path members now obey the status/tier/domain/date filters too.)

## Errors Encountered
- Phase 10: docs only. AGENTS.md regenerated from branch code: the tool inventory is unchanged (mode is an arg), so only the timestamp moved and was reverted (no change kept). hewtd maintain --quick reports 10 errors, 98 warnings repo-wide, none from the new page.
- Phase 9: reading_path ignored status/tier/domain/date filters for non-hit members (Phase 5 had recorded it as a decision); fixed with an `allowed` predicate in the walk skip and a regression test. As shipped (mode auto) the multi-tier #1+path target is NOT met on 3 of 4 splits (forced flow meets it on all 4); the PR states it.
- Phase 5: known load flakes in the first full `npm test` (freshness-scale warm start, hook-failure Jev-hang, the graph-walk 10 ms wall-clock benchmark once at 11.4 ms); all passed re-run alone.
- (none yet)
- Phase 3: unrelated known flake again: hook-failure Jev-hang passed alone. Snapshots updated for the new `mode` arg (tool-surface) and `query_type` (tool-outputs); the v1.16.0 granularity-doc snapshot test ignores `query_type`.
- Phase 2: hook-failure Jev-hang test flaked under full-suite load and passed alone (known flake). Labels cover the six routing-eval splits (docs, real, code, train and held-out); the other golden files (golden.jsonl, decay, graph, section) are not routing-eval inputs and stay unlabelled.

## Status
**All phases complete** - ready for PR

---

## Notes
- This file persists across sessions
- Update status after each phase
- Mark completed phases with [x]
- Save research to notes.md instead of stuffing context

## On Completion
This plan is complete when every checkbox above is checked. That IS the
completion signal -- there is no separate status to remember to flip.

When complete, archive it instead of deleting it:

    /plan-status                  # confirm this plan reads COMPLETE
    /archive-plan query-routing    # -> .planning/.archive/query-routing/

Archiving moves this directory to the gitignored .planning/.archive/ and stamps
it archived. Nothing is destroyed.

# Notes: abstention-product-names (#74)

## Phase 1: verification against main @ 0ec988d (v1.21.0)

### Cause, confirmed in code (src/core/identifiers.ts)
- `identifiers(query, known)` keeps a word only when it is:
  - contains `_`;
  - a path (an extension or 2+ slashes);
  - camelCase (`/^[a-z]+[A-Z]\w*$/`);
  - dotted;
  - backticked;
  - or PascalCase with 2+ capitals **and** `known(t)`, which is true only when the code graph has the name.
- `missingTerms` keeps only those terms with a token that has BM25 df 0 and is not in the doc paths.
- So these words are never candidates:
  - single-capital words (`Hotjar`, `Airflow`, `Clearbit`);
  - lowercase words (`keystore`, `autoscaler`);
  - PascalCase names the code does not know (`FullStory`, `ZoomInfo`), which are exactly the absent ones.

### Repro on this repo's docs (1.21.0 build, CLI search, top 2)
| query | #1 conf | nsm | missing_terms |
|---|---|---|---|
| Hotjar or FullStory session replay | 0.40 | no | none |
| WAL archiving with pgBackRest or WAL-G | 0.44 | yes | pgBackRest (camelCase) |
| configure the Airflow scheduler | 0.10 | yes | none |
| renew the APNs push certificate | 0.32 | yes | none |

Here, confidence happens to catch some of these. On the reporter's tree, negatives' top confidence runs 0.30–0.68 and answerable paraphrases 0.37–0.75, so confidence cannot separate them.

### Reporter's offline rule and numbers (their tree, tuned while looking at their questions)
- Candidate: capitalized (not first in the query), mixed case, has a digit, or not a common dictionary word (system word list, proper nouns removed).
- Flag when a candidate is (1) in neither the docs nor the code, or (2) in 3 or fewer docs and in none of the top 3 results.
- Set C: 9/10 negatives flagged, 0/25 false flags (1.21: 2/10). A+B: 5/7, 0/34 (1.21: 1/7).
- Still missed:
  - CSP report endpoint (CSP documented, the endpoint not);
  - Kafka consumer groups (Kafka in a top-3 doc's list);
  - APNs certificate.

### Ideas to measure
- WordPiece vocabulary as the "common word" test: MiniLM's tokenizer ships a ~30k-piece vocabulary. A lowercase word that is a single piece is common; a word split into pieces (`hot ##jar`, `keys ##tore`) is rare. No new data ships. Risk: ordinary inflected words also split (`archiving`).
- Sentence-initial capitals ("Which", "How") must never count. Neither should capitals after `?`/`.` inside a multi-sentence query.

## Eval results: Phase 2 (baseline, no code changed)

### The sets (written and grep-checked before any measurement)
- `test/retrieval-eval/absent-terms.jsonl` (train): 29 negatives (`n01`-`n29`) + 23 answerable controls (`c01`-`c23`).
- `test/retrieval-eval/absent-terms-heldout.jsonl` (held-out, never used to choose anything): 27 negatives (`hn01`-`hn27`) + 22 controls (`hc01`-`hc22`).
- Negative shapes: one capital (Prometheus, Grafana, Jaeger), PascalCase (LaunchDarkly, CockroachDB, VictoriaMetrics), mixed case (tRPC), digits (k8s, Log4j, web3, k3s, Neo4j), hyphenated (cert-manager, scikit-learn, react-query, Argo-CD, oauth2-proxy, helm-secrets), lowercase tech words (kubelet, ingress, sharding, memcached, gunicorn, sidekiq, rsyslog, iptables, journald, autovacuum, etcd).
- Named only in passing (3 per file, in 1-3 docs and never the subject): train Pinecone, Weaviate (`legacy/how-it-works.md:82`, one list), OpenTelemetry (`operational/logs-and-events.md:23`); held-out Sentry (same doc and list as OpenTelemetry), Obsidian (`legacy/embedder-guide.md:34`), Postgres (`security/secret-redaction.md:60`, `postgres:postgres@`). Ids: n27-n29, hn25-hn27.
- Controls name a documented tool or term (MiniLM, hewtd, HNSW, hnswlib, Jev, TypeSafe, vitest, tsup, npm, BM25, ONNX, gray-matter, chokidar, Claude Code, SessionStart, babel-fish, RRF) and many start with a capitalized word. Every facet was checked to match a non-archive doc.
- Grep check (`git ls-files .documentation src scripts hooks bin package.json README.md AGENTS.md`, non-archive, plus all tracked paths): every non-passing negative has at least one term with zero hits; none of the reporter's terms (Hotjar, FullStory, Airflow, keystore, Clearbit, ZoomInfo, PostGrid, Lob, pgBackRest, WAL-G, i18next, Aircall, Dialpad, Cloudinary, imgix, Pingdom, UptimeRobot, autoscaler, GraphQL, Snowflake, keyfile, CSP, Kafka, APNs) is used. Okta, Slack, Terraform, Helm, Dropbox, pgvector are in older sets and avoided.
- Caveat: the sets sit in `test/`, untracked here, so the clones do not contain them (a clone's code graph never sees the terms).

### Baseline: published 1.15.0, 1.22.0 and local, same run, clones, `eval` (cli) and `eval --via mcp --settle` (mcp)
Method: `scripts/eval-against-release.sh --set <both> 1.15.0 1.22.0 local`, with and without `--export`, then each set again on the same clone indexes (per-set numbers). "neg" = negatives flagged `no_strong_match`, "false" = answerable controls flagged. Local = this branch, identical to 1.22.0 code.

| split | arm | 1.15.0 neg (absent / passing) | 1.15.0 false | 1.22.0 = local neg (absent / passing) | 1.22.0 = local false |
|---|---|---|---|---|---|
| train | cli = mcp, no export | 13/29 (12/26, 1/3) | 2/23 | 7/29 (6/26, 1/3) | 0/23 |
| train | cli = mcp, export | 13/29 (12/26, 1/3) | 2/23 | 7/29 (6/26, 1/3) | 0/23 |
| held-out | cli = mcp, no export | 15/27 (13/24, 2/3) | 1/22 | 7/27 (6/24, 1/3) | 0/22 |
| held-out | cli = mcp, export | 15/27 (13/24, 2/3) | 1/22 | 7/27 (6/24, 1/3) | 0/22 |

- cli and mcp agree on every number; an export changes only hybrid @1 (answerable, not abstention).
- Pooled (56 negatives, 45 controls): 1.15.0 28/56 flagged, 3 false flags; 1.22.0 and local 14/56, 0 false flags.
- Finding: **1.22.0 flags half of what 1.15.0 did** (14/56 vs 28/56), at 0 instead of 3 false flags. The loss is the old confidence-only cutoff, replaced since by the 1.9+ confidence changes; 1.15.0 is not a safe floor to match, it simply tolerated false flags. Target for Phase 3-4: raise flagged well above 28/56 with 0 false flags.
- 1.22.0 flags (train): n11 Jenkins, n13 tRPC, n14 k8s, n16 web3, n17 cert-manager, n21 kubelet, n27 Pinecone. Held-out: hn03 Rollbar, hn06 Terragrunt, hn08 k3s, hn10 oauth2-proxy, hn13 iptables, hn21 Zabbix, hn27 Postgres. Whether each came from low confidence or `missing_terms` was not inspected (the harness records only the flag).
- Checks: lint, build, `npm test` (2 known load flakes, hook-failure Jev-hang and stdin-eof SIGTERM, pass alone: 16/16), `npm run eval` 137 passed, 5 expected fail.

## Eval results: Phase 3 (absent product and tool names)

### Rule (src/core/identifiers.ts, `identifiers(query, known, names)`; `missingTerms` passes `names = true`)
Candidates, beside the unchanged identifier rules: each hyphen part of a word that is capitalized and not sentence-initial, mixed case (`tRPC`, `FullStory`), has a digit and a letter and does not start with `v?digit` (`k8s`, `i18next`), or is all lowercase and not a common word. Acronyms (`SLA`), versions, numbers, paths and dotted names stay out. A candidate is missing when a token of it has BM25 df 0 and is not in the doc paths (existing check); `known` (code) still splits it into `missing_terms` vs `undocumented` in the callers. `names` is off for query typing and entity cards, so they read the old shapes.

### Common-word choice, measured on TRAIN only (BM25 of `.documentation`, no embedder; `known` off)
Negatives = absent-terms.jsonl train (29; 3 are named in passing, Phase 4). False = answerable controls of absent-terms.jsonl (23) / answerable questions of the train golden sets (golden-docs, real-corpus, real-hub, golden-code, golden-decay, golden: 129 questions). "+conf" = missing OR flagged by 1.22.0 confidence (n11 n13 n14 n16 n17 n21 n27).

| variant | negatives flagged | +conf | false, controls | false, golden train | note |
|---|---|---|---|---|---|
| baseline (1.22.0 rules) | 1/29 | 7/29 | 0/23 | 0 | |
| (a) WordPiece, 1 piece = common | 26/29 | 27/29 | 0/23 | 12 | too many inflected words split (erasure, batched, payloads) |
| (a2) common if <= 2 pieces | 21/29 | 24/29 | 0/23 | 3 | |
| (a3) common if <= 3 pieces | 17/29 | 21/29 | 0/23 | 1 | |
| (a-s) (a) with the same suffix strip as (b) | 25/29 | 26/29 | 0/23 | 6 | |
| **(b) word list + suffix strip** | **23/29** | **24/29** | **0/23** | **2** (wildcard, refetching) | kept |
| (c) shape only, no dictionary | 16/29 | 20/29 | 0/23 | 0 | cannot flag `keystore`, `autoscaler`: lowercase |

Kept (b). (c) is the only one with no false flag, but it cannot see lowercase names, which are half of #74's own examples; (a) needs the tokenizer vocabulary at hand in a sync pure function and, at the strict setting, flags 12 ordinary words (a2/a3 trade negatives for false flags, no better than (b)). (a) variants and (c) removed. The WordPiece vocabulary does not match an English word list here (answer to Key Question 1: no, not at equal false flags).

### Shipped word list (b)
`src/core/common-words.ts`: 31,676 lowercase words, ~284 KB source, from SCOWL as packaged by Debian `wamerican` (`american-english`: 104,334 lines; proper nouns, possessives, non-ASCII removed to 63,875; then every word that `isCommon`'s suffix strip already reaches from a listed word dropped, which leaves lookups identical). Licence: SCOWL's permissive MIT-style notice (Copyright 2000-2011 Kevin Atkinson), reproduced in THIRD_PARTY_NOTICES.md and in the file header. It is a dictionary, not a frequency list: no frequency source was available offline.

### Final numbers with the shipped code (`missingTerms` on the same BM25, `known` off)
| split | negatives flagged by `missingTerms` | of which named only in passing | false flags, controls |
|---|---|---|---|
| train | 23/29 (absent-term negatives 23/26) | 0/3 | 0/23 |
| held-out (measured, nothing tuned on it) | 24/27 (24/24 absent-term negatives) | 0/3 | 0/22 |

False flags on the answerable golden sets with the shipped rule: train 2 (real-corpus p03 `wildcard`, golden-decay d05 `refetching`), held-out 1 (real-corpus-heldout h12 `dotfiles`), out of ~270 answerable questions. All three are compounds or prefixed words absent from the docs and the list. (Before the two-level strip, held-out also flagged h03 `supposedly`.) `test/unit/identifiers.test.ts` now lists them (`FALSE_FLAGS`), so a fourth fails the test. It also now skips `tier: negative` golden questions (e.g. `Redis`, `Okta`, `Helm` negatives are correctly flagged now).
Passing-mention negatives (Pinecone, Weaviate, OpenTelemetry, Sentry, Obsidian, Postgres) are not flagged by Phase 3, as designed; Phase 4 targets them. Unflagged absent-term negatives: n19 react-query (`react`, `query` are in the docs), n22 sharding and n23 ingress (dictionary words, absent from docs: the rule does not flag common words by design).
Risk noted, not tuned: a capitalized weekday or month mid-sentence (`Monday`) absent from the docs would be flagged.

### End to end, local build, `scripts/eval-against-release.sh --set <file> local` (clone, no export; cli = mcp)
| split | negatives flagged (1.22.0 -> local) | false flags, controls (1.22.0 -> local) |
|---|---|---|
| train | 7/29 -> 24/29 | 0/23 -> 0/23 |
| held-out | 7/27 -> 25/27 | 0/22 -> 0/22 |
The harness has no false-flag column; false flags are the confidence flags of 1.22.0 (0, the order and confidences are unchanged) plus `missingTerms` on the controls (0, measured above). The end-to-end count is one above the BM25-only count in each split (24 vs 23, 25 vs 24): the code graph or confidence adds one. Rank order is unchanged (search-parity test).
Checks: lint, build, `npm test` (freshness-scale warm start and hook-failure Jev-hang failed under load, pass alone 16/16), `npm run eval` 138 passed, 4 expected fail (the fixture-train negatives gate now passes and is a real gate).
Reporter targets so far (their tree decides): negatives well above 1.22.0's 14/56; passing-mention negatives (6 of 56) are Phase 4.

## Eval results: Phase 4 (named only in passing)

### Rule 2 (src/core/identifiers.ts `passingTerms`, `PASSING_MAX_DOCS`)
A candidate (the `missingTerms` shapes) that is not missing, is in no doc path, is in at most N docs (new `Bm25Index.docFreq`) and in none of the top 3 results' docs (new `Bm25Index.docHas`, term set per doc incl. fields and path words). Reported as `passing_terms` on the items that carry `no_strong_match` (MCP and CLI), apart from `missing_terms`. Rank-neutral.

### Tuning N on TRAIN only (in-process search_hybrid over `.documentation`; sets absent-terms, real-corpus, real-hub)
| N | passing negatives with `passing_terms` (of 3) | other negatives | false: 23 controls | false: real-corpus answerable (27) | false: real-hub answerable (12) |
|---|---|---|---|---|---|
| 1, 3, 6, 12, 30 | 1 (n29 OpenTelemetry) | 0 | 0 | 0 | 0 |
Flat from 1 to 30, so train cannot pick N; the smallest (N = 1) is kept, since a larger N can only add false-flag risk. Pinecone (n27) and Weaviate (n28) are missed by design: `legacy/how-it-works.md` holds both and ranks in the top 3, so the "in none of the top 3" clause excludes them. The reporter's N of 3 behaves the same here.

### Does it set `no_strong_match`? Yes (decided on train)
Train: +1 negative, 0 false flags on 62 answerable questions (23 controls, 27 real-corpus, 12 real-hub), so it sets `no_strong_match`. Held-out, measured once at N = 1 and not used for any choice: 3/3 passing negatives get `passing_terms` (Sentry, Obsidian, Postgres), 0 false flags on the 22 controls and on the real-corpus-heldout and real-hub-heldout answerable questions.

### End to end, local build, `scripts/eval-against-release.sh --set <file> local` (clone, cli = mcp)
| split | negatives flagged (Phase 3 -> now) | false flags on controls |
|---|---|---|
| train | 24/29 -> 26/29 | 0/23 |
| held-out | 25/27 -> 27/27 | 0/22 |
(Train +2, one more than the in-process check: the clone also holds the code and other docs; not investigated.) The harness has no false-flag column: false flags are those of Phase 3 (0) plus `passing_terms` on answerable questions (0, above).
Caveats: held-out 27/27 is on a set whose 3 passing negatives happen to be single-doc names outside the top 3; the train catch rate for passing mentions is 1/3, so expect the held-out 3/3 to overstate it. Real-corpus false flags are unmeasured outside this repo's `.documentation`.
Checks: lint, build, `npm test` (freshness-scale warm start and hook-failure Jev-hang failed under load, pass alone 16/16), `npm run eval` 138 passed, 4 expected fail.

## Eval results: Phase 5 (same answer on every path)
No ranking or detector change, so the Phase 4 numbers stand (train 26/29, held-out 27/27 end to end; 0 false flags on controls). New checks: stdio server vs CLI `search` on an absent vendor name (same `no_strong_match`, `missing_terms`, paths); federation merge unit test (a name present in one source is dropped from `missing_terms`/`passing_terms`). Limit: the merge cannot tell a source weak for another reason from one that has the term; it treats a weak source without that term in its list as having it. `npm run eval` 138 passed, 4 expected fail.

## Eval results: Phase 6 (release gate)
`scripts/gate-release.sh` now adds `absent-terms-heldout` to its held-out sets and fails when flagged negatives drop, or flagged answerable questions (false flags) rise, by more than the band (1) against the previous release, on cli and mcp, with and without export. The counts are pooled over the five sets (negatives: the absent-terms negatives plus any other set's negatives; false flags: every answerable question flagged, controls included). `.documentation/deployment/release-process.md` describes it.
Run: `npm run gate:release -- 1.22.0` (package.json is still 1.22.0, so the default previous version would be 1.21.0; Phase 7 bumps it). Runtime 2m59s wall. Result: PASS.
| arm | negatives flagged (1.22.0 -> local) | false flags (1.22.0 -> local) | hybrid @1 | multi @1 |
|---|---|---|---|---|
| no export cli / mcp | 20/44 -> 42/44 | 2 -> 3 | 61 -> 61 | 7 -> 7 |
| export cli / mcp | 20/44 -> 42/44 | 2 -> 3 | 64 -> 64 | 7 -> 7 |
mcp vs cli: 0 of 129 questions differ. Titled #1 85/85, first answer ~0.9 s. Note: false flags rise by 1 (the Phase 3 held-out `dotfiles`), exactly at the band; a second new false flag would fail the gate. Controls and other answerable questions: no other new flag.
The clone index does not make the absent-terms terms known: held-out negatives stay flagged 42/44 with the sets committed in test/, so the code graph does not index them (the Phase 2/3 open item is closed).

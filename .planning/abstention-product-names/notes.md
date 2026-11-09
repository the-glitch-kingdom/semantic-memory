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

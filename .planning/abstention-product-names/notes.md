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

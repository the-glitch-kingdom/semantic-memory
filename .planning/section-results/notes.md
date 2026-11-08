# Notes: section-results

## Verification against main @ 29e74db (2026-11-08, read-only agent)
| #60 claim | Verdict | Evidence |
|---|---|---|
| Results are whole docs with a ~600-char excerpt | True | `EXCERPT_CHARS` 600 (`confidence.ts:8`), used in `shape()` (`search.ts:40-62`). Both arms return one result per doc (`vector.ts:100-138`, `bm25.ts:92-122`) |
| Long docs bury the answering section | True | Chunks are packed by sentence across headings (`indexer.ts:296-313`), heading markers are stripped (`indexer.ts:285`), and no chunk→heading map exists. `headers[]` is a flat per-doc list (`indexer.ts:253-266`) |
| Heading text is reliable | **False (new bug)** | `nodeToText` (`indexer.ts:268-272`) drops inline code: "# \`check_rls_coverage\` script" gives " script" |
| hewtd detects duplicates and writes pointers | True | `duplicates.ts`; pointers are written by `apply.ts:194-212` |
| ...and exports them | Not yet | No export code in hewtd. The contract gives `owner_of`, `points_to {from: "#a", to: "path#a"}` and `duplicates {section: "#a", owner: "path#a"}` |
| Prepending the heading trail is cheap | Per query yes, to index no | Vectors are keyed by chunk text (`context.ts:194`), so everything re-embeds once |
| Return `path#anchor` | Pushed back | `path` is used by `read_note`, the eval (`harness.ts:31`), telemetry and `related`. Keep `path` and add `anchor` |
| `granularity: "doc"` | New | No such option today |
| Payload stays within budget | At risk | The ceiling is 4750 bytes (`baseline.json`, `docs-eval.test.ts:155`) and output is pretty-printed (`search.ts:131`). Section fields add ~300-500 bytes |

- **Reuse:** `chunkText` per section, remark's heading positions, hewtd's anchor rules (`hit-em-with-the-docs/src/core/links/anchors.ts:14-89`, copied), `extractSection` (`section.ts`), #58's export reader, `doc.chunks.indexOf(matchedChunk)`.

## Eval results: Phase 2 (shipped v1.16.0 baseline, before any chunking code; 3 identical runs plus the gate run)
Fixture: test/fixtures/section-vault. Questions: 12 section + 4 fold (train), 12 section + 2 fold (held-out); written before any run, held-out never used to choose anything. A result's anchor is the section its snippet lies in (`anchorOfSnippet`, hewtd's flat-section rules) because v1.16.0 has no `anchor` field.

| split | arm | doc@1 | doc@3 | anchor@1 | anchor@3 | meanBytes | fold owner@1 | copy+pointer slots in top 3 |
|---|---|---|---|---|---|---|---|---|
| train | search_semantic | 7/12 | 9/12 | 3/12 | 3/12 | 5325 | 0/4 | 8 |
| train | search_hybrid | 11/12 | 12/12 | 3/12 | 4/12 | 5335 | 0/4 | 8 |
| heldout | search_semantic | 10/12 | 11/12 | 4/12 | 4/12 | 4642 | 0/2 | 4 |
| heldout | search_hybrid | 12/12 | 12/12 | 4/12 | 4/12 | 4659 | 0/2 | 4 |

Floors in baseline.json `sections` (one case of slack). Targets (it.fails today, real gates once met): hybrid anchor@1 >= 9/12 per split; owner first and no copy/pointer in top 3 in every fold case. Note meanBytes on train already exceeds the 4750 ceiling on this long-doc set (ceiling applies to the existing suites); Phase 4 must trim.

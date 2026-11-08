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

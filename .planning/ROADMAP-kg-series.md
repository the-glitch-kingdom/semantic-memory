# Search-with-a-knowledge-graph series (semantic-memory #56-#62)

Build order (from the series comment on each issue). Each plan is its own branch, PR and release.

| # | plan | issue | release | needs |
|---|---|---|---|---|
| 1 | builtin-eval | #56 | 1.13.0 | none |
| 2 | identifier-abstention | #57 | 1.14.0 | #56 |
| 3 | usage-capture-gaps | #59 (plan A) | 1.15.0 | #56; gaps.v1 contract (hewtd#66) |
| 4 | code-graph | #58 | 1.16.0 | #56, #57; graph.json v1 (hewtd#65, optional) |
| 5 | section-results | #60 | 1.17.0 | #56, #58 |
| 6 | query-routing | #61 | 1.18.0 | #56, #58, #60 |
| 7 | federated-search | #62 | 1.19.0 | #56, #61 |
| 8 | user-help | (new issue) | 1.20.0 | all of the above |

Later: #59 plan B (gated usage prior), after weeks of usage data.
hit-em-with-the-docs #65 and #66 are built in another session; we read their files when present.

---
title: Sentence-transformers models declare their pooling and query prompt in
  their own config
tier: fact
domains:
  - troubleshooting
audience:
  - all
tags:
  - gotcha
  - embeddings
  - pooling
  - bge
  - arctic
  - a swapped embedding model retrieves worse
status: active
last_updated: '2026-11-07'
version: 1.0.0
estimated_read_time: 1 minute
word_count: 181
last_validated: '2026-11-07'
backlinks: []
id: sentence-transformers-pooling-and-query-prompt-live-in-the-model-config
confidence: high
last_verified: '2026-11-07'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/unit/pooling.test.ts test/integration/pooling-prompt.test.ts
provenance:
  - 'https://github.com/the-glitch-kingdom/semantic-memory/issues/53'
sources:
  - src/core/pooling.ts
  - src/core/embedder.ts
invalidated_by:
  - the embedder stops reading the model's config files

---

# Sentence-transformers models declare their pooling and query prompt in their own config

## Claim
Each model ships `1_Pooling/config.json` (mean or CLS pooling) and `config_sentence_transformers.json` (optional prompts). MiniLM is mean-pooled with no prompt. `BAAI/bge-small-en-v1.5` is CLS with no prompt; `snowflake-arctic-embed-s` is CLS with the query prompt "Represent this sentence for searching relevant passages: ". Mean-pooling a CLS model, or skipping its query prompt, gives vectors that still work but retrieve worse, with no error. Before 1.12.0 semantic-memory always mean-pooled and never prompted.

## Instead
Let the embedder read the model's config (1.12.0 does, and records pooling and prompt in the index so a change reindexes). Override with `embedding.pooling` / `embedding.query_prompt` or `serve --pooling` / `--query-prompt`. The prompt goes on queries only, never on documents. Models that need a document prefix (nomic-embed: `search_query: ` / `search_document: `) are not supported.

## How to verify
`verify_command` runs the pooling unit tests (vectors byte-identical for MiniLM, CLS for a CLS config) and the integration test (the prompt is applied to queries only, a pooling change forces a reindex). Measured on our splits, bge-small and arctic-s with the right settings still did not beat MiniLM ([v1.12.0 changelog](../../changelog/v1-12-0-index-text-pooling-body-dates.md)).

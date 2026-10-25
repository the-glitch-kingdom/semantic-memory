---
title: >-
  commander's --no-<flag> makes the option default true, so the server always
  asked for the quantized model
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-24T00:00:00.000Z
id: commander-no-flag-makes-the-default-true
confidence: high
last_verified: '2026-10-25'
verify_command: >
  cd "$(git rev-parse --show-toplevel)" && npx vitest run
  test/integration/embedder.test.ts -t "fp32 model cached"
provenance:
  - >-
    observed in the v1.6.1 release audit (commander 14,
    sentence-transformers/all-MiniLM-L6-v2)
sources:
  - src/cli/index.ts
  - src/core/embedder.ts
  - test/integration/embedder.test.ts
tags:
  - gotcha
  - commander
  - embedder
  - offline
  - >-
    Downloading ONNX model: sentence-transformers/all-MiniLM-L6-v2
    (quantized)...
  - 'Quantized model not available, falling back to fp32'
  - 'error: unknown option ''--quantized'''
  - fetch failed
invalidated_by:
  - the CLI gains an explicit --quantized flag with default false
---

# commander's --no-<flag> makes the option default true, so the server always asked for the quantized model

## Claim
Declaring only `.option("--no-quantized", …)` in commander makes `opts.quantized` default to `true`. Commander doesn't define a `--quantized` flag either (`error: unknown option '--quantized'`). A library-level default of `false` (`DEFAULT_QUANTIZED` in `embedder.ts`) never applies to the server, because the CLI always passes `true`.

The default was harmless until combined with two facts:
- `sentence-transformers/all-MiniLM-L6-v2` has no `onnx/model_quantized.onnx` (HTTP 404).
- The embedder checked for `model_quantized.onnx` before falling back.

So every MCP server start downloaded the 90 MB fp32 model again. Offline, the fetch failed (`fetch failed`) and the embedder never started.

## Instead
Read the effective value in the CLI (`opts.quantized`), not the library default. Before downloading, use the cached `model.onnx` when the quantized file is missing (`src/core/embedder.ts`, 1.6.1).

## How to verify
The `verify_command` test stubs `fetch` to fail for `.onnx` URLs, like an offline host, then inits a quantized embedder with only the fp32 model cached. It must embed without any download attempt. Manual check: start the server twice; the second start's stderr must not contain `Downloading ONNX model`.

## Consequences
- From 0.4.2 to 1.6.0, every session's servers downloaded 90 MB at start.
- Downloads killed mid-way left `model.onnx.<pid>.<ts>.tmp` files: 192 files, 5.4 GB on one machine. They made the offline tarball 5.7 GB.
- Air-gapped installs couldn't start the embedder.

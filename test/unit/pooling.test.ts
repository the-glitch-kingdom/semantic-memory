import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { poolAndNormalizeMany, resolveEmbedSettings } from "../../src/core/pooling.js";
import { loadEmbeddingOverrides } from "../../src/core/fields.js";

// the mean arithmetic every pre-1.12 vector was built with (embedder.ts meanPoolAndNormalizeMany, verbatim)
function oldMean(out: Float32Array, mask: number[], n: number, seqLen: number, hidden: number): Float32Array[] {
  const results: Float32Array[] = [];
  for (let b = 0; b < n; b++) {
    const result = new Float32Array(hidden);
    let maskSum = 0;
    for (let t = 0; t < seqLen; t++) {
      const m = mask[b * seqLen + t];
      maskSum += m;
      const offset = (b * seqLen + t) * hidden;
      for (let d = 0; d < hidden; d++) result[d] += out[offset + d] * m;
    }
    if (maskSum > 0) for (let d = 0; d < hidden; d++) result[d] /= maskSum;
    let norm = 0;
    for (let d = 0; d < hidden; d++) norm += result[d] * result[d];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let d = 0; d < hidden; d++) result[d] /= norm;
    results.push(result);
  }
  return results;
}

// 2 texts, seqLen 3 (second is padded), hidden 2
const out = new Float32Array([3, 4, 0, 5, 6, 0, /* text 2 */ 1, 0, 9, 9, 9, 9]);
const mask = [1, 1, 1, 1, 0, 0];

describe("poolAndNormalizeMany", () => {
  it("mean is byte-identical to the pre-1.12 arithmetic", () => {
    const a = poolAndNormalizeMany(out, mask, 2, 3, 2, "mean");
    const b = oldMean(out, mask, 2, 3, 2);
    for (let i = 0; i < 2; i++) expect(Buffer.from(a[i].buffer).equals(Buffer.from(b[i].buffer))).toBe(true);
  });

  it("cls takes token 0 of each text, L2-normalized, ignoring the rest", () => {
    const [a, b] = poolAndNormalizeMany(out, mask, 2, 3, 2, "cls");
    expect([...a]).toEqual([Math.fround(3 / 5), Math.fround(4 / 5)]);
    expect([...b]).toEqual([1, 0]);
  });
});

describe("resolveEmbedSettings", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "model-cfg-"));
  const put = (d: string, rel: string, v: unknown) => {
    mkdirSync(join(d, rel, ".."), { recursive: true });
    writeFileSync(join(d, rel), JSON.stringify(v));
  };

  it("missing config files: mean, no prompt", () => {
    expect(resolveEmbedSettings(dir())).toEqual({ pooling: "mean", queryPrompt: "" });
  });

  it("reads cls and prompts.query from the model's own config", () => {
    const d = dir();
    put(d, "1_Pooling/config.json", { pooling_mode_cls_token: true, pooling_mode_mean_tokens: false });
    put(d, "config_sentence_transformers.json", { prompts: { query: "Q: " } });
    expect(resolveEmbedSettings(d)).toEqual({ pooling: "cls", queryPrompt: "Q: " });
  });

  it("a cached 404 marker ({}) means mean, no prompt", () => {
    const d = dir();
    put(d, "1_Pooling/config.json", {});
    put(d, "config_sentence_transformers.json", {});
    expect(resolveEmbedSettings(d)).toEqual({ pooling: "mean", queryPrompt: "" });
  });

  it("overrides win, including an empty prompt", () => {
    const d = dir();
    put(d, "1_Pooling/config.json", { pooling_mode_cls_token: true });
    put(d, "config_sentence_transformers.json", { prompts: { query: "Q: " } });
    expect(resolveEmbedSettings(d, { pooling: "mean", queryPrompt: "" })).toEqual({ pooling: "mean", queryPrompt: "" });
  });
});

describe("loadEmbeddingOverrides", () => {
  it("reads embedding.pooling and query_prompt from vault.schema.yml; ignores bad values", () => {
    const d = dir();
    writeFileSync(join(d, "vault.schema.yml"), 'embedding:\n  pooling: cls\n  query_prompt: "search_query: "\n');
    expect(loadEmbeddingOverrides(d)).toEqual({ pooling: "cls", queryPrompt: "search_query: " });
    writeFileSync(join(d, "vault.schema.yml"), "embedding:\n  pooling: max\n");
    expect(loadEmbeddingOverrides(d)).toEqual({});
    expect(loadEmbeddingOverrides(join(d, "nope"))).toEqual({});
  });
});

function dir() {
  return mkdtempSync(join(tmpdir(), "model-cfg-"));
}

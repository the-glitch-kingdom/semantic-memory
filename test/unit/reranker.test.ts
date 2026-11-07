import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { loadRerankConfig, Reranker, DEFAULT_RERANK_MODEL } from "../../src/core/reranker.js";
import type { SearchResult } from "../../src/core/types.js";

const res = (path: string, chunk: string): SearchResult => ({ path, title: path, score: 0.5, snippet: chunk, matchedChunk: chunk });

describe("loadRerankConfig", () => {
  it("is off with the default model when there is no config", async () => {
    const d = await mkdtemp(join(tmpdir(), "rr-"));
    expect(loadRerankConfig(d)).toEqual({ enabled: false, model: DEFAULT_RERANK_MODEL });
  });
  it("reads enabled and model, ignores wrong types", async () => {
    const d = await mkdtemp(join(tmpdir(), "rr-"));
    await writeFile(join(d, "vault.schema.yml"), "rerank:\n  enabled: true\n  model: x/y\n");
    expect(loadRerankConfig(d)).toEqual({ enabled: true, model: "x/y" });
    await writeFile(join(d, "vault.schema.yml"), "rerank:\n  enabled: yes please\n  model: 3\n");
    expect(loadRerankConfig(d)).toEqual({ enabled: false, model: DEFAULT_RERANK_MODEL });
  });
  it("falls back on malformed yaml", async () => {
    const d = await mkdtemp(join(tmpdir(), "rr-"));
    await writeFile(join(d, "vault.schema.yml"), "rerank: [unclosed");
    expect(loadRerankConfig(d).enabled).toBe(false);
  });
});

describe("Reranker", () => {
  afterAll(() => rm(join(homedir(), ".semantic-sidekick", "models", "sp-test--does-not-exist-model"), { recursive: true, force: true }));
  it("keeps the fused order when the model cannot be loaded", async () => {
    const input = [res("a.md", "one"), res("b.md", "two")];
    const rr = new Reranker("sp-test/does-not-exist-model");
    expect(await rr.rerank("q", input)).toEqual(input);
    expect(await rr.rerank("q", input)).toEqual(input); // second call: no retry, no second download attempt
  }, 30_000);

  const cached = existsSync(join(homedir(), ".semantic-sidekick", "models", DEFAULT_RERANK_MODEL.replace("/", "--"), "model.onnx"));
  it.skipIf(!cached)("puts the passage that answers the query first and sets rerankScore", async () => {
    const out = await new Reranker().rerank("how do I reset my password", [
      res("weather.md", "The forecast for tomorrow is sunny with light wind."),
      res("pw.md", "To reset your password, open Settings and choose Reset password."),
    ]);
    expect(out.map((r) => r.path)).toEqual(["pw.md", "weather.md"]);
    expect(out[0].rerankScore!).toBeGreaterThan(out[1].rerankScore!);
  }, 60_000);
});

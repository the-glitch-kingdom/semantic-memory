import { describe, it, expect, afterAll, vi } from "vitest";
import { AutoTokenizer } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CACHE_DIR, Embedder } from "../../src/core/embedder.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

const golden = JSON.parse(readFileSync(join(__dirname, "../fixtures/minilm-vectors.json"), "utf-8")) as {
  texts: string[];
  single: number[];
  batch: number[][];
};
const same = (a: Float32Array, b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
// batched ONNX output with padding is not bit-exact across CPUs (CI); a pooling change moves components by far more than 1e-5
const close = (a: Float32Array, b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-5);

describe("MiniLM vectors are unchanged by the pooling work", () => {
  it("embed, embedBatch and (no prompt) embedQuery equal vectors recorded before the change", async () => {
    const e = new Embedder();
    await e.init();
    expect(e.getPooling()).toBe("mean");
    expect(e.getQueryPrompt()).toBe("");
    expect(close(await e.embed(golden.texts[0]), golden.single)).toBe(true);
    expect(close(await e.embedQuery(golden.texts[0]), golden.single)).toBe(true);
    (await e.embedBatch(golden.texts)).forEach((v, i) => expect(close(v, golden.batch[i])).toBe(true));
  });
});

describe("query prompt", () => {
  it("goes in front of queries only; documents are embedded as written", async () => {
    const e = new Embedder(undefined, undefined, undefined, undefined, { queryPrompt: "search_query: " });
    await e.init();
    const t = "kubernetes deployment strategy";
    expect(same(await e.embedQuery(t), Array.from(await e.embed("search_query: " + t)))).toBe(true);
    expect(close(await e.embed(t), golden.single)).toBe(true);
    expect(close((await e.embedBatch([t]))[0], golden.single)).toBe(true);
    expect(close(await e.embedQuery(t), golden.single)).toBe(false);
  });
});

describe("a model that declares CLS pooling", () => {
  const name = "test/stub-cls-pooling";
  const modelDir = join(CACHE_DIR, name.replace("/", "--"));
  const real = join(CACHE_DIR, "sentence-transformers--all-MiniLM-L6-v2");
  afterAll(async () => {
    vi.restoreAllMocks();
    await rm(modelDir, { recursive: true, force: true });
  });

  it("uses CLS and its prompt with no flags, offline (stub model dir, MiniLM weights)", async () => {
    await new Embedder().init(); // MiniLM cached
    await mkdir(join(modelDir, "1_Pooling"), { recursive: true });
    await symlink(join(real, "model.onnx"), join(modelDir, "model.onnx"));
    // the stub has no tokenizer of its own: hand it MiniLM's
    const real_ = AutoTokenizer.from_pretrained.bind(AutoTokenizer);
    vi.spyOn(AutoTokenizer, "from_pretrained").mockImplementation(((m: string, o: never) => real_(m === name ? "sentence-transformers/all-MiniLM-L6-v2" : m, o)) as never);
    await writeFile(join(modelDir, "1_Pooling", "config.json"), JSON.stringify({ pooling_mode_cls_token: true }));
    await writeFile(join(modelDir, "config_sentence_transformers.json"), JSON.stringify({ prompts: { query: "Q: " } }));
    const e = new Embedder(name);
    await e.init();
    expect(e.getPooling()).toBe("cls");
    expect(e.getQueryPrompt()).toBe("Q: ");
    expect(same(await e.embed(golden.texts[0]), golden.single)).toBe(false); // not the mean-pooled vector
  });
});

describe("pooling or prompt change forces a re-embed", () => {
  let dir: string;
  afterAll(() => dir && cleanupTempDir(dir));

  it("meta records both; switching to cls reindexes with cls vectors", async () => {
    dir = await createTempVault();
    const meta = async () => JSON.parse(await readFile(join(dir, ".semantic-sidekick-index", "meta.json"), "utf-8"));
    await createServer(dir, { waitForReady: true });
    const first = await meta();
    expect(first.pooling).toBe("mean");
    expect(first.queryPrompt).toBe("");
    await createServer(dir, { waitForReady: true, pooling: "cls" });
    const second = await meta();
    expect(second.pooling).toBe("cls");
    expect(second.generation).toBeGreaterThan(first.generation);
    // cls vectors are cached under their own keys: the mean ones are still there for a switch back
    const keys = (JSON.parse(await readFile(join(dir, ".semantic-sidekick-index", "embeddings.json"), "utf-8")) as { key: string }[]).length;
    expect(keys).toBeGreaterThanOrEqual(second.totalChunks);
  }, 180_000);
});

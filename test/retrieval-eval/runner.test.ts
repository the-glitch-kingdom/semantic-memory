import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "../../src/mcp/server.js";
import { openEval } from "../../src/core/retrieval-eval/runner.js";
import { readMeta } from "../../src/core/index-store.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("openEval has no side effects", () => {
  let dir = "";
  afterAll(async () => dir && (await cleanupTempDir(dir)));

  it("refuses when there is no index", async () => {
    dir = await createTempVault();
    await expect(openEval(dir)).rejects.toThrow(/--reindex/);
    expect(existsSync(join(dir, ".semantic-sidekick-index"))).toBe(false);
  });

  it("keeps an index built with another pooling and prompt, and logs no searches", async () => {
    // a non-default pooling and prompt: opening with the defaults would force a full re-embed
    await createServer(dir, { watch: false, waitForReady: true, pooling: "cls", queryPrompt: "query: " });
    const idx = join(dir, ".semantic-sidekick-index");
    const files = ["hnsw.bin", "docs.cache.json", "meta.json"];
    const before = files.map((f) => sha(join(idx, f)));
    expect((await readMeta(idx))?.pooling).toBe("cls");

    const ev = await openEval(dir);
    const hits = await ev.tool("search_hybrid")("project notes", 3);
    await ev.tool("search_semantic")("project notes", 3);
    await ev.call("read_note", { path: hits.results[0].path });
    await ev.close();

    expect(files.map((f) => sha(join(idx, f)))).toEqual(before);
    expect(existsSync(join(idx, "selection.jsonl"))).toBe(false);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  }, 180_000);
});

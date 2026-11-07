import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { Embedder } from "../../src/core/embedder.js";
import { INDEX_SCHEMA_VERSION } from "../../src/core/indexer.js";
import { sha256 } from "../../src/core/reconcile.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

// v1.9.1: an index written by v1.7.2/v1.8 (positional `path:chunkIndex` vector keys, no commit record) or by v1.9.0
// (schema 3) is served as stale while a rebuild runs, and the rebuild embeds only chunks whose text changed.

const idx = (dir: string, f: string) => join(dir, ".semantic-sidekick-index", f);
const readJson = async (dir: string, f: string) => JSON.parse(await readFile(idx(dir, f), "utf-8"));

/** Rewrite the index the current code just built into the on-disk shape an older release left behind. */
async function downgrade(dir: string, format: "v1.7.2" | "v1.9.0") {
  const meta = await readJson(dir, "meta.json");
  if (format === "v1.9.0") {
    // schema 3 hashed only the node_modules glob
    const old = { ...meta, schemaVersion: 3, ignoreGlobs: sha256(JSON.stringify(["**/node_modules/**"])).slice(0, 16) };
    await writeFile(idx(dir, "meta.json"), JSON.stringify(old));
    return;
  }
  const labels: ({ docPath: string; chunkIndex: number; text: string } | null)[] = await readJson(dir, "hnsw-meta.json");
  const byKey = new Map((await readJson(dir, "embeddings.json") as { key: string; data: number[] }[]).map((e) => [e.key, e.data]));
  const positional = labels.flatMap((m) => {
    const data = m && byKey.get(sha256(`${meta.model}\0${m.text}`));
    return data ? [{ key: `${m.docPath}:${m.chunkIndex}`, data }] : [];
  });
  expect(positional.length).toBe(meta.totalChunks);
  await writeFile(idx(dir, "embeddings.json"), JSON.stringify(positional));
  await rm(idx(dir, "manifest.json"));
  await writeFile(idx(dir, "meta.json"), JSON.stringify({ model: meta.model, dimensions: meta.dimensions, totalChunks: meta.totalChunks, indexedAt: meta.indexedAt }));
}

async function connect(dir: string) {
  const server = await createServer(dir);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "upgrade-test", version: "1.0.0" });
  await client.connect(ct);
  return client;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 90_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("upgrading an index written by an older release", () => {
  let dir: string;
  let client: Client | null = null;

  beforeEach(async () => {
    dir = await createTempVault();
    await createServer(dir, { waitForReady: true });
  }, 180_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await client?.close();
    client = null;
    await cleanupTempDir(dir);
  });

  for (const format of ["v1.7.2", "v1.9.0"] as const) {
    it(`${format}: answers (stale) during the rebuild and re-embeds only the changed chunk`, async () => {
      const before = await readJson(dir, "meta.json");
      await downgrade(dir, format);
      await appendFile(join(dir, "orphan.md"), "\nA zebra-crossing sentence added after the old index was written.\n");

      // hold the rebuild's embedding step so the old index is the only thing that can answer
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const embedded: string[] = [];
      const real = Embedder.prototype.embedBatch;
      vi.spyOn(Embedder.prototype, "embedBatch").mockImplementation(async function (this: Embedder, texts, onProgress) {
        embedded.push(...texts);
        await gate;
        return real.call(this, texts, onProgress);
      });

      client = await connect(dir);
      const search = async () => {
        const res = await client!.callTool({ name: "search_hybrid", arguments: { query: "microservices architecture" } });
        return { text: (res.content as { text: string }[])[0].text, meta: (res as any)._meta };
      };
      await waitFor(async () => !(await search()).text.startsWith("Indexing in progress"));
      const during = await search();
      expect(JSON.parse(during.text).length).toBeGreaterThan(0);
      expect(during.meta?.stale).toBe(true);
      await waitFor(async () => embedded.length > 0); // the rebuild is now parked at its embedding step

      release();
      await waitFor(async () => (await readJson(dir, "meta.json")).schemaVersion === INDEX_SCHEMA_VERSION);
      await waitFor(async () => (await search()).meta?.stale !== true);

      expect(embedded).toHaveLength(1);
      expect(embedded[0]).toContain("zebra-crossing");
      const after = await readJson(dir, "meta.json");
      expect(after.totalChunks).toBe(before.totalChunks);
      // old positional keys are pruned: every stored vector is keyed by chunk text
      const keys = (await readJson(dir, "embeddings.json") as { key: string }[]).map((e) => e.key);
      expect(keys.every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true);
      expect(JSON.parse((await search()).text).length).toBeGreaterThan(0);
    }, 180_000);
  }
});

describe("excluded paths", () => {
  it("are graph-only nodes: no chunks, vectors or search hits", async () => {
    const dir = await createTempVault();
    try {
      await mkdir(join(dir, "archive"), { recursive: true });
      await writeFile(join(dir, "archive", "retired.md"), "# Retired\n\nThe quokka-protocol was replaced by the new gateway.\n");
      await writeFile(join(dir, "gateway-new.md"), "---\nsupersedes: archive/retired.md\n---\n\n# New gateway\n\nReplaces the quokka-protocol.\n");
      await createServer(dir, { waitForReady: true });

      const docs = await readJson(dir, "docs.cache.json") as { path: string; chunks: string[] }[];
      expect(docs.find((d) => d.path === "archive/retired.md")?.chunks).toEqual([]);
      const labels = (await readJson(dir, "hnsw-meta.json") as ({ docPath: string } | null)[]).filter(Boolean);
      expect(labels.some((m) => m!.docPath.startsWith("archive/"))).toBe(false);
      expect((await readJson(dir, "meta.json")).totalChunks).toBe(labels.length);
    } finally {
      await cleanupTempDir(dir);
    }
  }, 180_000);
});

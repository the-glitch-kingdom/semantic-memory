import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

// Issue #29 bug 1: a cached index that loads but no longer matches the notes on disk
// ("stale") was served forever; startup only reindexed when the cache failed to load.

const metaPath = (dir: string) => join(dir, ".semantic-sidekick-index", "meta.json");
const readMeta = async (dir: string) => JSON.parse(await readFile(metaPath(dir), "utf-8"));

async function connect(dir: string) {
  const server = await createServer(dir, { watch: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function indexState(client: Client): Promise<string> {
  const res = await client.callTool({ name: "get_stats", arguments: {} });
  return JSON.parse((res.content as { text: string }[])[0].text).indexState;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 60_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("startup with a cached index", () => {
  let tempDir: string;
  let client: Client | null = null;

  beforeEach(async () => {
    tempDir = await createTempVault();
    // build and persist the cache once
    await createServer(tempDir, { watch: false, waitForReady: true });
  }, 180_000);

  afterEach(async () => {
    await client?.close();
    client = null;
    await cleanupTempDir(tempDir);
  });

  it("rebuilds a stale cache in the background", async () => {
    const before = await readMeta(tempDir);
    await writeFile(
      join(tempDir, "added-after-index.md"),
      "# Added after index\n\nA note written while no server was running, so the cache misses it.\n"
    );

    client = await connect(tempDir);
    await waitFor(async () => (await readMeta(tempDir)).totalChunks > before.totalChunks);
    await waitFor(async () => (await indexState(client!)) === "ready");

    const after = await readMeta(tempDir);
    expect(after.indexedAt).not.toBe(before.indexedAt);
  }, 120_000);

  it("still forces a reindex when the embedding model changed", async () => {
    const before = await readMeta(tempDir);
    await writeFile(metaPath(tempDir), JSON.stringify({ ...before, model: "someone/other-model" }), "utf-8");

    client = await connect(tempDir);
    await waitFor(async () => (await readMeta(tempDir)).model === before.model);
    expect((await readMeta(tempDir)).indexedAt).not.toBe(before.indexedAt);
  }, 120_000);

  it("does not reindex a fresh cache", async () => {
    const before = await readMeta(tempDir);

    client = await connect(tempDir);
    await waitFor(async () => (await indexState(client!)) === "ready");
    await new Promise((r) => setTimeout(r, 1_000));

    expect((await readMeta(tempDir)).indexedAt).toBe(before.indexedAt);
  }, 120_000);
});

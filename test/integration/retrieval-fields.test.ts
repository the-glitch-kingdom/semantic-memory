import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { Embedder } from "../../src/core/embedder.js";
import { cleanupTempDir } from "../setup.js";

// semantic-memory#44 acceptance checks, end to end through the MCP server.

const PLAYBOOK = (phrase: string) => `---
title: Queue Lag Playbook
symptoms:
  - user_phrase: ${phrase}
    error_pattern: "ERR_Q[0-9]+_STALLED"
    alert_name: PagerQueueStallHigh
    target: secret-target-token
    severity: zorblax-severity
    cites: [facts/f1]
  - user_phrase:
      - nothing gets delivered to subscribers
      - subscribers see no messages
---

# Restart the broker

Drain the spool and restart the broker process, then confirm the consumers reconnect.
`;

let dir: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse((res.content as { text: string }[])[0].text);
};
const docs = async () => JSON.parse(await readFile(join(dir, ".semantic-sidekick-index", "docs.cache.json"), "utf-8")) as any[];

describe("retrieval-ready fields (#44)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-fields-"));
    await mkdir(join(dir, "ops"), { recursive: true });
    await writeFile(join(dir, "ops", "queue-lag.md"), PLAYBOOK("the inbox keeps growing and nothing drains"));
    await writeFile(join(dir, "ops", "tls.md"), "# TLS certificates\n\nRenew certificates before they expire.\n");
    await writeFile(join(dir, "ops", "backups.md"), "# Backups\n\nNightly snapshots go to cold storage.\n");
    await writeFile(join(dir, "report.md"), "---\ngenerated: true\n---\n\n# Report\n\nThe inbox keeps growing and nothing drains; see [[ops/queue-lag]] and [[ops/tls]].\n");
    await writeFile(join(dir, "hub.md"), "# Hub\n\nSee [[report]] and [[ops/tls]].\n");
    const server = await createServer(dir, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "fields-test", version: "1.0.0" });
    await client.connect(ct);
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await client?.close();
    await cleanupTempDir(dir);
  });

  it("a doc matched only through its symptoms is in the top 3, with the frontmatter title and the matched field", async () => {
    const hits = await call("search_hybrid", { query: "subscribers see no messages", limit: 3 });
    const hit = hits.find((h: any) => h.path === "ops/queue-lag.md");
    expect(hit).toBeTruthy();
    expect(hit.title).toBe("Queue Lag Playbook");
    expect(hit.matched?.field).toBe("symptoms");
    expect(hit.snippet).toContain("broker"); // the excerpt stays the body
  });

  it("indexes user_phrase (string and list), error_pattern and alert_name, never target, cites or severity", async () => {
    const d = (await docs()).find((x) => x.path === "ops/queue-lag.md");
    const meta = d.meta.map((m: any) => m.text);
    expect(meta).toContain("the inbox keeps growing and nothing drains");
    expect(meta).toContain("nothing gets delivered to subscribers");
    expect(meta).toContain("PagerQueueStallHigh");
    expect(meta).not.toContain("ERR_Q[0-9]+_STALLED"); // regex text is BM25-only
    for (const t of ["ERR_Q", "PagerQueueStallHigh"]) expect(d.fieldText).toContain(t);
    for (const t of ["secret-target-token", "zorblax-severity", "facts/f1"]) expect(d.fieldText).not.toContain(t);
  });

  it("generated docs are never returned and are not graph nodes", async () => {
    for (const q of ["inbox keeps growing and nothing drains", "Report"]) {
      const hits = await call("search_hybrid", { query: q, limit: 10 });
      expect(hits.map((h: any) => h.path)).not.toContain("report.md");
      expect((await call("search_text", { pattern: q })).map((h: any) => h.path)).not.toContain("report.md");
    }
    const back = await call("backlinks", { path: "ops/queue-lag.md" });
    expect(back.map((n: any) => n.path)).not.toContain("report.md");
    const fwd = await call("forwardlinks", { path: "hub.md" });
    expect(fwd.map((n: any) => n.path)).not.toContain("report.md");
    const stats = await call("get_stats", {});
    expect(stats.fieldCoverage.docs).toBe(4); // the generated report is not counted
  });

  it("editing only the frontmatter symptoms embeds only the new metadata text", async () => {
    const embedded: string[] = [];
    const real = Embedder.prototype.embedBatch;
    vi.spyOn(Embedder.prototype, "embedBatch").mockImplementation(async function (this: Embedder, texts, onProgress) {
      embedded.push(...texts);
      return real.call(this, texts, onProgress);
    });
    await writeFile(join(dir, "ops", "queue-lag.md"), PLAYBOOK("messages pile up and never leave"));
    await call("reindex", {}).catch(() => undefined);
    expect(embedded).toEqual(["messages pile up and never leave"]);
  }, 120_000);
});

describe("upgrading from a v1.9.1 index", () => {
  it("serves the old index while only the metadata chunks embed; body vectors are reused", async () => {
    const d = await mkdtemp(join(tmpdir(), "sp-fields-up-"));
    const idx = (f: string) => join(d, ".semantic-sidekick-index", f);
    const readJson = async (f: string) => JSON.parse(await readFile(idx(f), "utf-8"));
    let c: Client | null = null;
    try {
      await mkdir(join(d, "ops"), { recursive: true });
      await writeFile(join(d, "ops", "queue-lag.md"), PLAYBOOK("the inbox keeps growing and nothing drains"));
      await writeFile(join(d, "ops", "tls.md"), "# TLS certificates\n\nRenew certificates before they expire.\n");
      await createServer(d, { waitForReady: true });

      // rewrite what v1.9.1 left: schema 4, no field-list in the parser hash, no metadata vectors
      const meta = await readJson("meta.json");
      const metaTexts = new Set<string>((await readJson("docs.cache.json")).flatMap((x: any) => (x.meta ?? []).map((m: any) => m.text)));
      expect(metaTexts.size).toBeGreaterThan(0);
      const { indexExclude, loadPathClassConfig } = await import("../../src/core/path-class.js");
      const { ignoreGlobsHash } = await import("../../src/core/index-store.js");
      const { sha256 } = await import("../../src/core/reconcile.js");
      await writeFile(idx("meta.json"), JSON.stringify({ ...meta, schemaVersion: 4, ignoreGlobs: ignoreGlobsHash(indexExclude(loadPathClassConfig(d))) }));
      const keep = (await readJson("embeddings.json") as { key: string }[]).filter((e) => ![...metaTexts].some((t) => e.key === sha256(`${meta.model}\0${t}`)));
      await writeFile(idx("embeddings.json"), JSON.stringify(keep));

      const embedded: string[] = [];
      const real = Embedder.prototype.embedBatch;
      vi.spyOn(Embedder.prototype, "embedBatch").mockImplementation(async function (this: Embedder, texts, onProgress) {
        embedded.push(...texts);
        return real.call(this, texts, onProgress);
      });
      const server = await createServer(d, { waitForReady: true });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      c = new Client({ name: "up", version: "1.0.0" });
      await c.connect(ct);
      expect([...new Set(embedded)].sort()).toEqual([...metaTexts].sort());
      expect((await readJson("meta.json")).schemaVersion).toBeGreaterThan(4);
      const res = await c.callTool({ name: "search_hybrid", arguments: { query: "subscribers see no messages", limit: 3 } });
      expect(JSON.parse((res.content as { text: string }[])[0].text)[0].path).toBe("ops/queue-lag.md");
    } finally {
      vi.restoreAllMocks();
      await c?.close();
      await cleanupTempDir(d);
    }
  }, 180_000);
});

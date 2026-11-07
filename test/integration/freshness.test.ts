import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyFile, readFile, readdir, utimes, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildContext, type ServerContext } from "../../src/mcp/context.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { filesMatchMeta, readMeta } from "../../src/core/index-store.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

const NOW = { reconcileThrottleMs: 0 };

/** Load the cache if there is one and reconcile, else build: what server startup does. */
async function open(dir: string, throttleMs = 0) {
  const ctx = await buildContext(dir, { reconcileThrottleMs: throttleMs });
  const cached = await ctx.tryLoadCachedIndex();
  if (cached) await ctx.reconcileNow();
  else await ctx.fullIndex();
  const embedded = { texts: 0 };
  const embedBatch = ctx.embedder.embedBatch.bind(ctx.embedder);
  vi.spyOn(ctx.embedder, "embedBatch").mockImplementation(((texts: string[], cb: any) => {
    embedded.texts += texts.length;
    return embedBatch(texts, cb);
  }) as any);
  const parsed = vi.spyOn(ctx.indexer, "indexFile");
  return { ctx, cached, embedded, parsed };
}

async function top(ctx: ServerContext, query: string): Promise<string | undefined> {
  return ctx.getVectorIndex()?.search(await ctx.embedder.embed(query), 3)[0]?.path;
}

const inotifyLines = async () => {
  let n = 0;
  for (const fd of await readdir("/proc/self/fdinfo")) {
    const info = await readFile(join("/proc/self/fdinfo", fd), "utf-8").catch(() => "");
    n += info.split("\n").filter((l) => l.startsWith("inotify")).length;
  }
  return n;
};

describe("index freshness without a watcher", () => {
  let dir: string;
  const open_: ServerContext[] = [];
  const track = async (throttle = 0) => {
    const o = await open(dir, throttle);
    open_.push(o.ctx);
    return o;
  };

  beforeEach(async () => {
    dir = await createTempVault();
  });
  afterEach(async () => {
    await Promise.all(open_.splice(0).map((c) => c.flushIndex().catch(() => {})));
    vi.restoreAllMocks();
    await cleanupTempDir(dir);
  });

  it("an edit made mid-session reaches the next search and re-embeds only that doc", async () => {
    const { ctx, embedded, parsed } = await track();
    await ctx.flushIndex();
    await writeFile(join(dir, "orphan.md"), "# Orphan\n\nThe zebra migration protocol uses striped handshakes.\n");
    await ctx.ensureFresh();

    expect(parsed).toHaveBeenCalledTimes(1);
    expect(embedded.texts).toBe(ctx.getDocByPath().get("orphan.md")!.chunks.length);
    expect(ctx.getDocByPath().get("orphan.md")!.content).toContain("zebra");
    expect(await top(ctx, "zebra striped handshakes")).toBe("orphan.md");
  }, 180_000);

  it("picks up new files and drops deleted ones from search", async () => {
    const { ctx } = await track();
    await writeFile(join(dir, "fresh.md"), "# Fresh\n\nPelican logistics for the harbour cranes.\n");
    await unlink(join(dir, "orphan.md"));
    await ctx.ensureFresh();

    expect(ctx.getDocByPath().has("fresh.md")).toBe(true);
    expect(ctx.getDocByPath().has("orphan.md")).toBe(false);
    expect(await top(ctx, "pelican harbour cranes")).toBe("fresh.md");
    const paths = ctx.getVectorIndex()!.getChunkMeta().map((m) => m.docPath);
    expect(paths).not.toContain("orphan.md");
  }, 180_000);

  it("touching every file without changing content re-parses and re-embeds nothing", async () => {
    const { ctx, embedded, parsed } = await track();
    const later = new Date(Date.now() + 60_000);
    for (const doc of ctx.getDocuments()) await utimes(join(dir, doc.path), later, later);
    await ctx.ensureFresh();
    expect(parsed).not.toHaveBeenCalled();
    expect(embedded.texts).toBe(0);
  }, 180_000);

  it("a warm start with nothing changed parses and embeds nothing, and is not stale after the first reconcile", async () => {
    const first = await track();
    await first.ctx.flushIndex();

    const ctx = await buildContext(dir, NOW);
    open_.push(ctx);
    const parsed = vi.spyOn(ctx.indexer, "indexFile");
    expect(await ctx.tryLoadCachedIndex()).toBe(true);
    expect(ctx.isStale()).toBe(true);
    expect(ctx.getDocuments().length).toBe(first.ctx.getDocuments().length);
    await ctx.reconcileNow();
    expect(ctx.isStale()).toBe(false);
    expect(ctx.getIndexState()).toBe("ready");
    expect(parsed).not.toHaveBeenCalled();
  }, 180_000);

  it("an edit made while no server ran is re-parsed and re-embedded on the next start, and only it", async () => {
    const first = await track();
    await first.ctx.flushIndex();
    // no last_updated bump: only the bytes and fs stat change
    await writeFile(join(dir, "orphan.md"), "# Orphan\n\nQuokka telemetry rollups run nightly.\n");

    const second = await track();
    expect(second.cached).toBe(true);
    expect(await top(second.ctx, "quokka telemetry rollups")).toBe("orphan.md");
  }, 180_000);

  it("a schemaVersion bump re-parses every file but embeds nothing whose text is unchanged", async () => {
    const first = await track();
    await first.ctx.flushIndex();
    const metaPath = join(dir, ".semantic-sidekick-index", "meta.json");
    await writeFile(metaPath, JSON.stringify({ ...(await readMeta(join(dir, ".semantic-sidekick-index"))), schemaVersion: 0 }));

    const ctx = await buildContext(dir, NOW);
    open_.push(ctx);
    const parsed = vi.spyOn(ctx.indexer, "indexFile");
    expect(await ctx.tryLoadCachedIndex()).toBe(false);
    const spy = vi.spyOn(ctx.embedder, "embedBatch");
    await ctx.fullIndex();
    expect(parsed).toHaveBeenCalledTimes(first.ctx.getDocuments().length);
    expect(spy).not.toHaveBeenCalled();
    await ctx.flushIndex();
    expect((await readMeta(join(dir, ".semantic-sidekick-index")))?.schemaVersion).toBe(1);
  }, 180_000);

  it("a commit that died between renames is detected on the next start and recovered", async () => {
    const first = await track();
    await first.ctx.flushIndex();
    const index = join(dir, ".semantic-sidekick-index");
    const goodDocs = join(dir, "docs.cache.json.bak");
    await copyFile(join(index, "docs.cache.json"), goodDocs);

    // a second commit renamed docs.cache.json but died before meta.json
    await writeFile(join(index, "docs.cache.json"), JSON.stringify([]));
    expect(await filesMatchMeta(index, (await readMeta(index))!)).toBe(false);

    const ctx = await buildContext(dir, NOW);
    open_.push(ctx);
    expect(await ctx.tryLoadCachedIndex()).toBe(false);
    await ctx.fullIndex();
    expect(ctx.getDocuments().length).toBe(first.ctx.getDocuments().length);
    await ctx.flushIndex();
    expect(await filesMatchMeta(index, (await readMeta(index))!)).toBe(true);
  }, 180_000);

  it("holds no inotify watches", async () => {
    const before = await inotifyLines();
    const server = await createServer(dir, { waitForReady: true });
    await server.close();
    expect(await inotifyLines()).toBe(before);
  }, 180_000);

  it("two processes on one tree never leave a corrupt index", async () => {
    const a = await track();
    const b = await track();
    await a.ctx.flushIndex();
    await writeFile(join(dir, "orphan.md"), "# Orphan\n\nAxolotl regeneration schedule.\n");
    await Promise.all([a.ctx.ensureFresh(), b.ctx.ensureFresh()]);
    await Promise.all([a.ctx.flushIndex(), b.ctx.flushIndex()]);

    const index = join(dir, ".semantic-sidekick-index");
    expect(await filesMatchMeta(index, (await readMeta(index))!)).toBe(true);
    expect(existsSync(join(index, "index.lock"))).toBe(false);
    const c = await track();
    expect(c.cached).toBe(true);
    expect(await top(c.ctx, "axolotl regeneration schedule")).toBe("orphan.md");
  }, 240_000);

  it("an edit made during a reconcile is picked up by the next call", async () => {
    const { ctx } = await track();
    await writeFile(join(dir, "orphan.md"), "# Orphan\n\nFirst edit about narwhals.\n");
    const running = ctx.ensureFresh();
    await writeFile(join(dir, "fresh.md"), "# Fresh\n\nSecond edit about capybara scheduling.\n");
    await running;
    await ctx.ensureFresh();
    expect(ctx.getDocByPath().get("orphan.md")!.content).toContain("narwhals");
    expect(ctx.getDocByPath().has("fresh.md")).toBe(true);
  }, 180_000);

  it("throttles reconciles to one per window, and serializes concurrent callers", async () => {
    const { ctx } = await track(60_000);
    await ctx.reconcileNow();
    await writeFile(join(dir, "fresh.md"), "# Fresh\n\nThrottled.\n");
    await ctx.ensureFresh();
    expect(ctx.getDocByPath().has("fresh.md")).toBe(false); // inside the window: not looked at

    const { ctx: ctx2 } = await track(0);
    const walks = vi.spyOn(ctx2.indexer, "indexFile");
    await Promise.all([ctx2.ensureFresh(), ctx2.ensureFresh(), ctx2.ensureFresh()]);
    expect(walks).toHaveBeenCalledTimes(0); // fresh.md was already indexed by the open() above
    expect(ctx2.getDocByPath().has("fresh.md")).toBe(true);
  }, 180_000);

  it("a note written through the server is searchable at once, inside the throttle window", async () => {
    const server = await createServer(dir, { waitForReady: true, reconcileThrottleMs: 60_000 });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(ct);
    try {
      await client.callTool({ name: "create_note", arguments: { path: "made-here.md", content: "# Made here\n\nOcelot dispatch rota.\n" } });
      const res = await client.callTool({ name: "search_text", arguments: { pattern: "ocelot dispatch" } });
      expect(JSON.parse((res.content as { text: string }[])[0].text).map((r: any) => r.path)).toContain("made-here.md");
    } finally {
      await client.close();
    }
  }, 180_000);
});

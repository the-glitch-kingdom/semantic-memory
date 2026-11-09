import { describe, it, expect, afterEach, vi } from "vitest";
import { appendFile, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #73: a slow code graph load must not hold back doc metadata of a swapped-in index.
const gate = vi.hoisted(() => ({ release: null as null | (() => void), hold: false, waiters: [] as (() => void)[], calls: 0 }));
vi.mock("../../src/core/code-graph.js", async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    loadCodeData: async (...a: unknown[]) => {
      const n = ++gate.calls;
      if (gate.hold) await new Promise<void>((r) => { gate.waiters.push(r); gate.release = () => gate.waiters.splice(0).forEach((w) => w()); });
      const code = await real.loadCodeData(...a);
      return code && Object.assign(code, { tag: n });
    },
  };
});

import { buildContext, type ServerContext } from "../../src/mcp/context.js";
import { createTempVault, cleanupTempDir } from "../setup.js";
import { gitHistory, stampDates } from "../retrieval-eval/git-history.js";

describe("doc metadata is installed with the index, the code graph after", () => {
  let dir = "";
  let ctx: ServerContext | undefined;
  afterEach(async () => {
    gate.release?.();
    gate.hold = false;
    await ctx?.flushIndex().catch(() => {});
    await cleanupTempDir(dir);
  });

  it("warm load and reconcile swap serve titles while the code graph is pending, marked stale", async () => {
    dir = await createTempVault();
    ctx = await buildContext(dir, { reconcileThrottleMs: 0 });
    await ctx.fullIndex();
    await ctx.flushIndex();
    const path = ctx.getDocuments()[0].path;
    const title = ctx.getDocuments()[0].title;

    gate.hold = true;
    const warm = await buildContext(dir, { reconcileThrottleMs: 0 });
    expect(await warm.tryLoadCachedIndex()).toBe(true); // returns without waiting for the code graph
    expect(warm.enrichResult({ path }).title).toBe(title);
    expect(warm.isStale()).toBe(true);
    gate.release!();
    await warm.reconcileNow();
    await vi.waitFor(() => expect(warm.isStale()).toBe(false));
    expect(warm.getCodeLoad()).toMatchObject({ source: expect.stringMatching(/^(export|fallback|none)$/), loadMs: expect.any(Number) });

    // reconcile swap: a changed file is installed at once, the code graph follows
    gate.hold = true;
    await appendFile(join(dir, path), "\n\nA new paragraph about zebras.\n");
    await warm.reconcileNow();
    expect(warm.getDocuments().find((d) => d.path === path)?.chunks.join(" ")).toContain("zebras");
    expect(warm.enrichResult({ path }).title).toBe(title);
    expect(warm.isStale()).toBe(true);
    gate.release!();
    await vi.waitFor(() => expect(warm.isStale()).toBe(false));
    await warm.flushIndex();
  }, 120_000);

  it("adding or removing .hewtd/graph.json changes only grounding: titles, metadata and the vector order stay", async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-export-"));
    await cp(join(import.meta.dirname, "..", "fixtures", "code-graph-vault"), dir, { recursive: true });
    await stampDates(dir);
    await gitHistory(dir);
    const seen = async () => {
      const c = await buildContext(join(dir, ".documentation"), { reconcileThrottleMs: 0 });
      await c.fullIndex();
      ctx = c;
      await vi.waitFor(() => expect(c.isStale()).toBe(false));
      const meta = c.getDocuments().slice().sort((a, b) => a.path.localeCompare(b.path)).map((d) => ({ ...c.enrichResult({ path: d.path }), score: 0 }));
      const order = c.getVectorIndex()!.search(await c.embedder.embed("how do backend jobs get scheduled"), 8).map((r) => r.path);
      await c.flushIndex();
      return { meta: meta.map(({ grounding, ...m }: any) => m), order };
    };
    const withExport = await seen();
    await rm(join(dir, ".hewtd"), { recursive: true });
    await rm(join(dir, ".documentation", ".semantic-sidekick-index"), { recursive: true, force: true });
    const without = await seen();
    expect(without.meta).toEqual(withExport.meta);
    expect(without.order).toEqual(withExport.order);
  }, 120_000);

  it("an older code load finishing last does not overwrite the newer docs' code", async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-order-"));
    await cp(join(import.meta.dirname, "..", "fixtures", "code-graph-vault"), dir, { recursive: true });
    await stampDates(dir);
    await gitHistory(dir);
    const notes = join(dir, ".documentation");
    const c0 = await buildContext(notes, { reconcileThrottleMs: 0 });
    await c0.fullIndex();
    await c0.flushIndex();
    const path = c0.getDocuments()[0].path;

    gate.hold = true;
    const warm = await buildContext(notes, { reconcileThrottleMs: 0 });
    ctx = warm;
    expect(await warm.tryLoadCachedIndex()).toBe(true);
    await appendFile(join(notes, path), "\n\nA new paragraph about zebras.\n");
    await warm.reconcileNow();
    await vi.waitFor(() => expect(gate.waiters.length).toBe(2));
    const [older, newer] = gate.waiters.splice(0);
    const newest = gate.calls;
    newer();
    await vi.waitFor(() => expect((warm.getCode() as any)?.tag).toBe(newest));
    older(); // the older load lands last
    await vi.waitFor(() => expect(warm.isStale()).toBe(false));
    expect((warm.getCode() as any).tag).toBe(newest);
  }, 120_000);
});

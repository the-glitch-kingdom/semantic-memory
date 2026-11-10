import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// #90: a slow code graph load (as on a big repo's `git log`).
vi.mock("../../src/core/code-graph.js", async (orig) => {
  const real: any = await orig();
  return { ...real, loadCodeData: async (...a: unknown[]) => { await new Promise((r) => setTimeout(r, 1500)); return real.loadCodeData(...a); } };
});

import { buildContext, type ServerContext } from "../../src/mcp/context.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";
import { gitHistory, stampDates } from "../retrieval-eval/git-history.js";
import { parseGolden } from "../retrieval-eval/eval.js";

/**
 * Cold build: the first answer must equal the answer after the code graph has landed. Grounding (dead references, drift) multiplies
 * each doc's score, so an index that is ready before it lands ranks the first answers differently, and ranks 4 and 5 swap two seconds later.
 * code-graph-vault has docs whose grounding is below 1. The reproductions are `it.fails` until the cold path waits for the code load
 * (whole-answer-ranking Phase 3), then plain `it`.
 */
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "code-graph-vault");
const AGES = async (dir: string) => {
  const { glob } = await import("glob");
  const ages: Record<string, number> = {};
  for (const f of await glob("**/*.{md,py,sh}", { cwd: dir, dot: true })) ages[f] = f.endsWith(".md") ? 300 : f.startsWith("backend/jobs/") ? 3 : 200;
  return ages;
};
type Hit = { path: string; score: number };

describe("cold build is final when it says ready (#90)", () => {
  let dir = "";
  let notes = "";
  let ctx: ServerContext | undefined;
  let client: Client | undefined;
  let questions: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-cold-ready-"));
    await cp(FIXTURE, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
    await stampDates(dir);
    await gitHistory(dir, await AGES(dir));
    notes = join(dir, ".documentation");
    questions = (parseGolden(await readFile(join(import.meta.dirname, "..", "retrieval-eval", "golden-graph.jsonl"), "utf-8")) as unknown as { q: string }[]).map((c) => c.q);
  });
  afterEach(async () => {
    await client?.close().catch(() => {});
    await ctx?.flushIndex().catch(() => {});
    client = ctx = undefined;
    await cleanupTempDir(dir);
  });

  const answers = async (c: Client): Promise<Hit[][] | null> => {
    const out: Hit[][] = [];
    for (const q of questions) {
      const res: any = await c.callTool({ name: "search_hybrid", arguments: { query: q, limit: 8 } });
      let parsed: unknown;
      try { parsed = JSON.parse(res.content[0].text); } catch { return null; } // "Indexing in progress"
      out.push((parsed as Hit[]).map((h) => ({ path: h.path, score: h.score })));
    }
    return out;
  };
  const connect = async (waitForReady: boolean) => {
    const server = await createServer(notes, { watch: false, waitForReady, reconcileThrottleMs: 0, telemetry: false });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "cold-ready", version: "1.0.0" });
    await client.connect(ct);
    return client;
  };
  const same = (got: Hit[][], want: Hit[][]) => {
    expect(got.map((r) => r.map((h) => h.path))).toEqual(want.map((r) => r.map((h) => h.path)));
    got.forEach((r, i) => r.forEach((h, j) => expect(h.score).toBeCloseTo(want[i][j].score, 6))); // ONNX batches are not bit-exact across CPUs
  };
  const settled = async (c: Client) => {
    // the settled answer: wait until a search is no longer marked stale (the code graph has landed)
    let res: any;
    await vi.waitFor(async () => { res = await c.callTool({ name: "search_hybrid", arguments: { query: questions[0], limit: 1 } }); expect(res._meta?.stale).toBeFalsy(); }, { timeout: 30_000, interval: 100 });
    return (await answers(c))!;
  };

  it.fails("fullIndex() resolves only when the code graph has landed: not stale", async () => {
    ctx = await buildContext(notes, { reconcileThrottleMs: 0 });
    await ctx.fullIndex();
    expect(ctx.isStale()).toBe(false);
  }, 120_000);

  it.fails("with waitForReady, the first answer equals the settled answer", async () => {
    const c = await connect(true);
    const first = (await answers(c))!;
    same(first, await settled(c));
  }, 120_000);

  it.fails("without waitForReady, the first answer that is not 'Indexing in progress' equals the settled answer", async () => {
    const c = await connect(false);
    let first: Hit[][] | null = null;
    await vi.waitFor(async () => { first = await answers(c); expect(first).not.toBeNull(); }, { timeout: 60_000, interval: 20 });
    same(first!, await settled(c));
  }, 120_000);
});

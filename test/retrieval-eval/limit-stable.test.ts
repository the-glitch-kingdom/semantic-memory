import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { openSearch, type Searcher } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Prefix property (#85): search(q, k) is the first k results of search(q, 8), same order, same scores, for every k <= 8 (above 8 the candidate pool grows).
 * Over this repo's own .documentation, where the vector and BM25 top lists disagree enough for a candidate pool sized by `limit` to matter.
 * Broke on main (17 of 21 cases) before the fixed candidate pool.
 */
const DOCS = join(import.meta.dirname, "..", "..", ".documentation");
const LIMITS = [1, 3, 5];
const QUERIES = [
  "what does the freshness check do on a warm start",
  "what happens when the index lock is stale",
  "how do I publish a release to npm",
  "how are semantic and keyword scores combined",
  "which hooks run when a session starts",
  "how does the offline tarball install on an air-gapped host",
  "fuseScores",
  "how do I undo a bad release",
  "where are embeddings stored on disk",
  "what is the candidate pool",
];

type Hit = { path: string; score: number };
const same = (got: Hit[], want: Hit[]) => {
  expect(got.map((h) => h.path)).toEqual(want.map((h) => h.path));
  got.forEach((h, i) => expect(h.score).toBeCloseTo(want[i].score, 6)); // ONNX batches are not bit-exact across CPUs
};

describe("limit does not change the ranking (prefix property)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  let cli: Searcher;
  const arms: Record<string, (q: string, k: number) => Promise<Hit[]>> = {};

  beforeAll(async () => {
    env = await startEval(DOCS, "sp-limit-stable-");
    cli = await openSearch(env.dir);
    const mcp = (name: string) => async (q: string, k: number) => (await env.call(name, { query: q, limit: k })).parsed as Hit[];
    arms.search_hybrid = mcp("search_hybrid");
    arms.search_semantic = mcp("search_semantic");
    arms.cli = (q, k) => cli.search(q, k);
  }, 600_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  for (const tool of ["search_hybrid", "search_semantic", "cli"]) {
    for (const q of QUERIES) {
      it(`${tool}: ${q}`, async () => {
        const full = await arms[tool](q, 8);
        expect(full.length).toBeGreaterThan(0);
        for (const k of LIMITS) same(await arms[tool](q, k), full.slice(0, k));
      }, 120_000);
    }
  }
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { startEval } from "./harness.js";
import { VectorIndex, type ChunkMeta } from "../../src/core/vector.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Two full builds of identical files must rank identically (#85, second comment).
 * Separate temp copies and index dirs, so no embedding cache is shared.
 */
const DOCS = join(import.meta.dirname, "..", "..", ".documentation");
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
type Env = Awaited<ReturnType<typeof startEval>>;

describe("two builds of the same files rank the same", () => {
  let a: Env, b: Env;
  beforeAll(async () => {
    a = await startEval(DOCS, "sp-repro-a-");
    b = await startEval(DOCS, "sp-repro-b-");
  }, 900_000);
  afterAll(async () => {
    for (const e of [a, b]) {
      await e?.client.close();
      if (e) await cleanupTempDir(e.dir);
    }
  });

  for (const tool of ["search_semantic", "search_hybrid"]) {
    it(`${tool}: paths and order identical, scores within 1e-6`, async () => {
      for (const query of QUERIES) {
        const [x, y] = await Promise.all([a, b].map(async (e) => (await e.call(tool, { query, limit: 8 })).parsed as Hit[]));
        expect(y.map((h) => h.path), query).toEqual(x.map((h) => h.path));
        x.forEach((h, i) => expect(y[i].score).toBeCloseTo(h.score, 6));
      }
    }, 120_000);
  }

  it("embeddings of the two builds differ by at most 1e-6 (record the real max)", async () => {
    const load = async (e: Env) => new Map<string, number[]>((JSON.parse(await readFile(join(e.dir, ".semantic-sidekick-index", "embeddings.json"), "utf-8")) as { key: string; data: number[] }[]).map((r) => [r.key, r.data]));
    const [ma, mb] = await Promise.all([load(a), load(b)]);
    let max = 0;
    for (const [k, v] of ma) v.forEach((x, i) => (max = Math.max(max, Math.abs(x - mb.get(k)![i]))));
    console.log(`max abs embedding difference across builds: ${max} over ${ma.size} vectors`);
    expect(max).toBeLessThan(1e-6);
  });
});

describe("1e-6 float noise on the embeddings does not move the ranking", () => {
  it("top 8 is unchanged unless two docs are within the noise", async () => {
    const dir = (await startEvalIndexDir()).dir;
    try {
      const entries = JSON.parse(await readFile(join(dir, ".semantic-sidekick-index", "embeddings.json"), "utf-8")) as { key: string; data: number[] }[];
      const meta: ChunkMeta[] = entries.map((e, i) => ({ docPath: `d${Math.floor(i / 3)}.md`, chunkIndex: i % 3, text: e.key }));
      const clean = entries.map((e) => Float32Array.from(e.data));
      let seed = 7; // deterministic noise
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2e-6;
      const noisy = clean.map((v) => v.map((x) => x + rnd()));
      const A = new VectorIndex(clean[0].length), B = new VectorIndex(clean[0].length);
      A.build(clean, meta);
      B.build(noisy, meta);
      let compared = 0;
      for (let q = 0; q < clean.length; q += 7) {
        const ra = A.search(clean[q], 9), rb = B.search(clean[q], 9);
        // a gap under 1e-4 between neighbours (the self-match scores 1.0 and ties are legitimate) is within noise
        const tied = ra.slice(0, 9).some((r, i) => i > 0 && Math.abs(r.score - ra[i - 1].score) < 1e-4);
        if (tied) continue;
        compared++;
        expect(rb.slice(0, 8).map((r) => r.path)).toEqual(ra.slice(0, 8).map((r) => r.path));
      }
      expect(compared).toBeGreaterThan(20);
    } finally {
      await cleanupTempDir(dir);
    }
  }, 600_000);
});

// the noise test only needs one built embeddings.json
async function startEvalIndexDir() {
  const e = await startEval(DOCS, "sp-repro-n-");
  await e.client.close();
  return e;
}

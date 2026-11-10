import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startEval } from "../../test/retrieval-eval/harness.js";
import { parseGolden } from "../../src/core/retrieval-eval/metrics.js";
import { cleanupTempDir } from "../../test/setup.js";
const EVAL = join(import.meta.dirname, "..", "..", "test", "retrieval-eval");
it("build twice, 115 queries; same query x20", async () => {
  const qs: string[] = [];
  for (const f of ["real-corpus", "real-corpus-heldout", "real-hub", "real-hub-heldout"]) for (const c of parseGolden(readFileSync(join(EVAL, `${f}.jsonl`), "utf-8")) as any[]) if (c.negative_kind !== "identifier") qs.push(c.q);
  const a = await startEval(join(import.meta.dirname, "..", "..", ".documentation"), "dc-a-");
  const b = await startEval(join(import.meta.dirname, "..", "..", ".documentation"), "dc-b-");
  const out: any = { n: qs.length };
  try {
    for (const tool of ["search_hybrid", "search_semantic"]) {
      let diffTop8 = 0, diff1 = 0, maxScore = 0;
      for (const q of qs) {
        const [x, y] = await Promise.all([a, b].map(async (e) => (await e.call(tool, { query: q, limit: 8 })).parsed as any[]));
        if (JSON.stringify(x.map((h) => h.path)) !== JSON.stringify(y.map((h) => h.path))) diffTop8++;
        if (x[0]?.path !== y[0]?.path) diff1++;
        x.forEach((h, i) => y[i] && (maxScore = Math.max(maxScore, Math.abs(h.score - y[i].score))));
      }
      out[tool] = { diffTop8, diff1, maxScoreGap: maxScore };
    }
    let nonIdentical = 0;
    for (const q of qs.slice(0, 10)) {
      const first = JSON.stringify(((await a.call("search_hybrid", { query: q, limit: 8 })).parsed as any[]).map((h) => [h.path, h.score]));
      for (let i = 0; i < 19; i++) if (JSON.stringify(((await a.call("search_hybrid", { query: q, limit: 8 })).parsed as any[]).map((h) => [h.path, h.score])) !== first) nonIdentical++;
    }
    out.repeat20 = { queries: 10, nonIdentical };
  } finally { for (const e of [a, b]) { await e.client.close(); await cleanupTempDir(e.dir); } }
  process.stderr.write("\nRESULT " + JSON.stringify(out) + "\n");
  expect(out.repeat20.nonIdentical).toBe(0);
}, 1_200_000);

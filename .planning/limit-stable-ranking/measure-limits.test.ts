import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startEval } from "../../test/retrieval-eval/harness.js";
import { gitHistory } from "../../test/retrieval-eval/git-history.js";
import { runFacetEval, formatArm, facetRank, parseGolden, type FacetCase } from "../../src/core/retrieval-eval/metrics.js";
import { cleanupTempDir } from "../../test/setup.js";

/**
 * #85 baseline / re-measure: per-limit #1 accuracy of search_hybrid (the mcp arm, in-process as in real-corpus-eval.test.ts) over the
 * answerable questions of the built-in real-* sets, how many questions change #1 across limits 3-10, and the eval's own metrics + p95 at limit 8.
 * OUT=<file> writes the numbers as JSON.
 */
const LIMITS = [1, 3, 5, 8, 10, 20];
const SETS: Record<string, string> = { "real-train": "real-corpus", "real-heldout": "real-corpus-heldout", "hub-train": "real-hub", "hub-heldout": "real-hub-heldout" };
const EVAL = join(import.meta.dirname, "..", "..", "test", "retrieval-eval");

it("per-limit #1 accuracy", async () => {
  const env = await startEval(join(import.meta.dirname, "..", "..", ".documentation"), "sp-limit-measure-", (dir) => gitHistory(dir));
  const arm = env.tool("search_hybrid");
  const out: Record<string, any> = {};
  let report = "";
  try {
    for (const [name, file] of Object.entries(SETS)) {
      const cases = (parseGolden(readFileSync(join(EVAL, `${file}.jsonl`), "utf-8")) as unknown as FacetCase[]).filter((c) => c.negative_kind !== "identifier");
      const answerable = cases.filter((c) => c.tier !== "negative" && c.facets?.length);
      const top: Record<number, Record<string, string>> = {};
      for (const k of LIMITS) {
        top[k] = {};
        for (const c of answerable) top[k][c.id] = (await arm(c.q, k)).results[0]?.path ?? "";
      }
      const at1 = Object.fromEntries(LIMITS.map((k) => [k, answerable.filter((c) => top[k][c.id] && facetRank(c.facets!, [top[k][c.id]], env.textOf) === 1).length]));
      const changed = answerable.filter((c) => new Set([3, 5, 8, 10].map((k) => top[k][c.id])).size > 1).map((c) => c.id);
      const metrics = await runFacetEval(cases, arm, env.textOf); // the eval's own run: limit 8 (max of FACET_KS), timed
      out[name] = { n: answerable.length, at1, changedAcross3to10: changed.length, changedIds: changed, p95Ms: Math.round(metrics.latencyMs.p95), p50Ms: Math.round(metrics.latencyMs.p50), metrics: JSON.parse(JSON.stringify(metrics)) };
      report += `${name} n=${answerable.length}  #1 answers by limit: ${LIMITS.map((k) => `${k}:${at1[k]}`).join(" ")}  #1 changes 3-10: ${changed.length}  p50/p95@8: ${out[name].p50Ms}/${out[name].p95Ms}ms\n${formatArm("search_hybrid", metrics)}\n`;
    }
  } finally {
    await env.client.close();
    await cleanupTempDir(env.dir);
  }
  process.stderr.write("\n" + report + "\n");
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitGates, identifierGate } from "./gates.js";
import { startEval } from "./harness.js";
import { runFacetEval, formatArm, parseGolden, facetRank, hnswRecall, type FacetCase, type ArmMetrics } from "./eval.js";
import { glob } from "glob";
import { cleanupTempDir } from "../setup.js";
import { gitHistory } from "./git-history.js";

/**
 * The same facet eval over this repo's own .documentation (the in-process twin of scripts/retrieval-eval/real-corpus.mjs, which runs the
 * production launch): real-corpus.jsonl is the train split, real-corpus-heldout.jsonl the held-out one, never tuned on.
 * baseline.json holds the floors. EVAL_OUT=<file> writes the numbers as JSON.
 */
const HERE = import.meta.dirname;
const DOCS = join(HERE, "..", "..", ".documentation");
// Gates v1.9.0 fails, run as expected failures until Phase 4 (score fusion) fixes them; see .planning/v191-ranking-regression/notes.md "Eval results".
// real-heldout negatives: 8/8 locally, 7/8 on CI (HNSW is random per build), so one miss is allowed, like the real-corpus floors
const KNOWN: Record<string, { atOne?: boolean; paraphrase?: boolean; falseFlags?: boolean; negatives?: boolean; negativesSlack?: number; falseFlagsSlack?: number }> = { "real-train": { negatives: true }, "real-heldout": { negativesSlack: 1, falseFlagsSlack: 1 } };

describe("Facet eval (real corpus: .documentation)", () => {
  const baseline = JSON.parse(readFileSync(join(HERE, "baseline.json"), "utf-8"));
  const splits: Record<string, { cases: FacetCase[]; arms: Record<string, ArmMetrics> }> = {};
  let env: Awaited<ReturnType<typeof startEval>>;
  let recall: number;
  const idArms: Record<string, ArmMetrics> = {};
  let allQs: string[] = [];

  beforeAll(async () => {
    env = await startEval(DOCS, "sp-real-eval-", (dir) => gitHistory(dir));
    for (const [name, file] of [["real-train", "real-corpus.jsonl"], ["real-heldout", "real-corpus-heldout.jsonl"]] as const) {
      const all = parseGolden(await readFile(join(HERE, file), "utf-8")) as unknown as FacetCase[];
      const cases = all.filter((c) => c.negative_kind !== "identifier");
      allQs.push(...all.map((c) => c.q));
      idArms[name] = await runFacetEval(all.filter((c) => c.negative_kind === "identifier"), env.tool("search_hybrid"), env.textOf);
      splits[name] = { cases, arms: {
        search_semantic: await runFacetEval(cases, env.tool("search_semantic"), env.textOf),
        search_hybrid: await runFacetEval(cases, env.tool("search_hybrid"), env.textOf),
      } };
    }
    recall = await hnswRecall(env.dir, allQs, 24);
    process.stderr.write(
      "\nReal-corpus facet eval\n" +
      Object.entries(splits).map(([n, s]) => `  ${n}\n` + Object.entries(s.arms).map(([a, m]) => formatArm(a, m)).join("\n")).join("\n") +
      "\nIdentifier negatives (search_hybrid)\n" + Object.entries(idArms).map(([n, m]) => `  ${n}: flagged ${m.negativesFlagged}/${m.negativeTop.length}`).join("\n") +
      `\n  hnsw recall@24 vs exact cosine=${recall.toFixed(3)}\n\n`
    );
    if (process.env.EVAL_OUT) await writeFile(`${process.env.EVAL_OUT}.real`, JSON.stringify({ splits, recall }, null, 2));
  }, 600_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  it("every answerable case is answerable from the live docs, and the held-out set keeps its size", () => {
    const live = glob.sync("**/*.md", { cwd: DOCS }).filter((p) => !/(^|\/)archive\//.test(p));
    const texts = new Map(live.map((p) => [p, readFileSync(join(DOCS, p), "utf-8")]));
    for (const { cases } of Object.values(splits)) {
      for (const c of cases.filter((c) => c.tier !== "negative")) expect(facetRank(c.facets!, live, (p) => texts.get(p)!), c.id).not.toBeNull();
    }
    const h = splits["real-heldout"].cases;
    expect(h.filter((c) => c.tier !== "negative").length).toBeGreaterThanOrEqual(20);
    expect(h.filter((c) => c.tier === "paraphrase").length).toBeGreaterThanOrEqual(10);
    expect(h.filter((c) => c.tier === "multi").length).toBeGreaterThanOrEqual(6);
    expect(h.filter((c) => c.tier === "negative").length).toBeGreaterThanOrEqual(8);
    expect(splits["real-train"].cases.filter((c) => c.tier === "negative").length).toBeGreaterThanOrEqual(12);
  });

  splitGates("real train", () => splits["real-train"].arms as any, baseline.splits["real-train"], KNOWN["real-train"], baseline.tiers["real-train"]);
  splitGates("real held-out", () => splits["real-heldout"].arms as any, baseline.splits["real-heldout"], KNOWN["real-heldout"], baseline.tiers["real-heldout"]);

  // expected failures until identifier-abstention Phase 4 wires missingTerms into no_strong_match
  identifierGate("real train", () => idArms["real-train"]);
  identifierGate("real held-out", () => idArms["real-heldout"]);

  // v1.9.0 searched at hnswlib's default ef=10 (recall 0.929 here); VectorIndex.search sets ef >= 100.
  it(`HNSW recall against exact cosine is at least ${baseline.hnswRecallMin}`, () => {
    expect(recall).toBeGreaterThanOrEqual(baseline.hnswRecallMin);
  });
});

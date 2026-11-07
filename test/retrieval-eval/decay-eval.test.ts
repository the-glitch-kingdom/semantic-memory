import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { gitHistory, stampDates } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Decay fixture eval (boost-decay-fallback Phase 2, semantic-memory#49). test/fixtures/decay-vault holds pairs of equally relevant docs:
 * the answer has a recent `last_verified`, its twin has none (tier "unverified", git/file age 800 days) or a 400-day-old one (tier
 * "old-verified", the control that decays today). A case is answered when the answer doc ranks first. The temp copy gets a backdated git
 * history, so the `git` fallback can be measured; ages.json holds each doc's commit and file age.
 * EVAL_OUT=<file> also writes the numbers as JSON.
 */
const HERE = import.meta.dirname;
const FIXTURE = join(HERE, "..", "fixtures", "decay-vault");

interface DecayCase { id: string; tier: string; q: string; answer: string; twin: string }
interface Row { id: string; tier: string; answerRank: number | null; twinRank: number | null; beatsTwin: boolean; top1: string; top1Decay?: { multiplier: number; source?: string }; answerDecay?: { multiplier: number; source?: string }; twinDecay?: { multiplier: number; source?: string } }
type Table = Record<string, Record<string, Row[]>>; // split -> arm -> rows

describe("Decay fixture eval (verified doc vs unverified twin)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  const table: Table = {};

  beforeAll(async () => {
    const ages = JSON.parse(await readFile(join(FIXTURE, "ages.json"), "utf-8"));
    env = await startEval(FIXTURE, "sp-decay-eval-", async (dir) => { await stampDates(dir); await gitHistory(dir, ages); });
    for (const [split, file] of [["train", "golden-decay.jsonl"], ["heldout", "golden-decay-heldout.jsonl"]] as const) {
      const cases = parseGolden(await readFile(join(HERE, file), "utf-8")) as unknown as DecayCase[];
      for (const arm of ["search_semantic", "search_hybrid"]) {
        const run = env.tool(arm);
        const rows: Row[] = [];
        for (const c of cases) {
          const r = await run(c.q, 8);
          const paths = r.results.map((x) => x.path);
          const rank = (p: string) => (paths.includes(p) ? paths.indexOf(p) + 1 : null);
          const [a, t] = [rank(c.answer), rank(c.twin)];
          rows.push({ id: c.id, tier: c.tier, answerRank: a, twinRank: t, beatsTwin: a !== null && (t === null || a < t), top1: paths[0], top1Decay: r.decay?.[paths[0]], answerDecay: r.decay?.[c.answer], twinDecay: r.decay?.[c.twin] });
        }
        ((table[split] ??= {})[arm] = rows);
      }
    }
    const at1 = (rows: Row[], tier?: string) => { const rs = rows.filter((r) => !tier || r.tier === tier); return `${rs.filter((r) => r.answerRank === 1).length}/${rs.length}`; };
    process.stderr.write("\nDecay fixture eval (answer ranked first)\n" + Object.entries(table).map(([s, arms]) => Object.entries(arms).map(([a, rows]) =>
      `  ${s.padEnd(8)} ${a.padEnd(16)} all=${at1(rows)}  unverified=${at1(rows, "unverified")}  old-verified=${at1(rows, "old-verified")}  sources=${JSON.stringify([...new Set(rows.flatMap((r) => [r.answerDecay?.source, r.twinDecay?.source]).filter(Boolean))])}`).join("\n")).join("\n") + "\n\n");
    if (process.env.EVAL_OUT) await writeFile(`${process.env.EVAL_OUT}.decay`, JSON.stringify(table, null, 2));
  }, 180_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  const count = (split: string, arm: string, tier: string, pick: (r: Row) => boolean) => table[split][arm].filter((r) => r.tier === tier && pick(r)).length;
  const total = (split: string, arm: string, tier: string) => table[split][arm].filter((r) => r.tier === tier).length;

  it("the fixture keeps its size: >= 4 unverified and >= 2 old-verified cases in each split", () => {
    for (const s of ["train", "heldout"]) {
      expect(total(s, "search_hybrid", "unverified")).toBeGreaterThanOrEqual(4);
      expect(total(s, "search_hybrid", "old-verified")).toBeGreaterThanOrEqual(2);
    }
  });

  // The control: a 400-day-old last_verified already decays, so the recent twin must win today.
  it.each(["train", "heldout"])("%s: the recently verified doc beats a twin whose last_verified is 400 days old (control)", (s) => {
    for (const arm of ["search_semantic", "search_hybrid"]) expect(count(s, arm, "old-verified", (r) => r.beatsTwin), arm).toBe(total(s, arm, "old-verified"));
  });

  // Shipped (v1.10.0): a missing last_verified fails open, so the unverified twin is not down-weighted and train wins only by chance (4 of 6).
  // Expected failure until Phase 4 (#49) turns it into a real gate. Held-out happened to win every case at baseline (6/6, chance, not decay), so its gate is real from the start.
  it.fails("train: the recently verified doc beats an unverified twin (git age 800 days)", () => {
    expect(count("train", "search_hybrid", "unverified", (r) => r.beatsTwin)).toBe(total("train", "search_hybrid", "unverified"));
  });
  it("heldout: the recently verified doc beats an unverified twin (git age 800 days)", () => {
    expect(count("heldout", "search_hybrid", "unverified", (r) => r.beatsTwin)).toBe(total("heldout", "search_hybrid", "unverified"));
  });
});

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
 * "old-verified", the control that decays today; tier "frontmatter-touch": the twin's body is 400 days old but a frontmatter-only commit touched it today, #54). A case is answered when the answer doc ranks first. The temp copy gets a backdated git
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
    const touched = JSON.parse(await readFile(join(FIXTURE, "touched.json"), "utf-8"));
    env = await startEval(FIXTURE, "sp-decay-eval-", async (dir) => { await stampDates(dir); await gitHistory(dir, ages, 10, touched); });
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
      `  ${s.padEnd(8)} ${a.padEnd(16)} all=${at1(rows)}  unverified=${at1(rows, "unverified")}  old-verified=${at1(rows, "old-verified")}  frontmatter-touch=${at1(rows, "frontmatter-touch")}  sources=${JSON.stringify([...new Set(rows.flatMap((r) => [r.answerDecay?.source, r.twinDecay?.source]).filter(Boolean))])}`).join("\n")).join("\n") + "\n\n");
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

  // v1.10.0 failed open on a missing last_verified, so the twin won by chance (4 of 6 on train); v1.11 ages it by its git date (#49).
  it("train: the recently verified doc beats an unverified twin (git age 800 days)", () => {
    expect(count("train", "search_hybrid", "unverified", (r) => r.beatsTwin)).toBe(total("train", "search_hybrid", "unverified"));
  });
  it("the unverified twin's decay block names the git source", () => {
    for (const s of ["train", "heldout"]) {
      const sources = table[s].search_hybrid.filter((r) => r.tier === "unverified").map((r) => r.twinDecay?.source).filter(Boolean);
      expect(sources.length, s).toBeGreaterThan(0);
      expect(new Set(sources)).toEqual(new Set(["git"]));
    }
  });
  it("heldout: the recently verified doc beats an unverified twin (git age 800 days)", () => {
    expect(count("heldout", "search_hybrid", "unverified", (r) => r.beatsTwin)).toBe(total("heldout", "search_hybrid", "unverified"));
  });

  // #54 (index-text-pooling-body-dates): a frontmatter-only commit today moves the file's git date, not its body's. v1.11.0 dates the twin today (multiplier 1.0, so
  // relevance alone decides: 3/3 train, 2/3 held-out); Phase 4 dates it by its last body change (400 days, multiplier ~0.47 like the old-verified control).
  it("train: the recently verified doc beats a twin touched by a frontmatter-only commit", () => {
    expect(count("train", "search_hybrid", "frontmatter-touch", (r) => r.beatsTwin)).toBe(total("train", "search_hybrid", "frontmatter-touch"));
  });
  it.fails("heldout: the recently verified doc beats a twin touched by a frontmatter-only commit", () => {
    expect(count("heldout", "search_hybrid", "frontmatter-touch", (r) => r.beatsTwin)).toBe(total("heldout", "search_hybrid", "frontmatter-touch"));
  });
  for (const s of ["train", "heldout"]) {
    it.fails(`${s}: the touched twin decays as its 400-day-old body (multiplier below 0.6, source git)`, () => {
      const twins = table[s].search_hybrid.filter((r) => r.tier === "frontmatter-touch").map((r) => r.twinDecay);
      expect(twins.length).toBeGreaterThan(0);
      for (const d of twins) { expect(d?.source).toBe("git"); expect(d!.multiplier).toBeLessThan(0.6); }
    });
  }
});

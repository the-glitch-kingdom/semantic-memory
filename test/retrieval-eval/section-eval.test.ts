import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { gitHistory, stampDates } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { anchorOfSnippet, summarize, type SectionRow } from "./section-metrics.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Section-results eval (section-results Phase 2, semantic-memory#60). test/fixtures/section-vault: three 1,000+ line runbooks with deep, repeated headings
 * (tier `section`: the answer is one section, scored by the anchor of the result) and three families of an owner section, a marked copy and a pointer doc
 * with a `.hewtd/graph.json` (tier `fold`: the owner must take the slot, the copy and pointer must not). A result's anchor is its `anchor` field when it has one;
 * before that field existed it is the section the returned snippet lies in (anchorOfSnippet), which is what a reader of the shipped output could tell.
 * EVAL_OUT=<file> also writes the numbers as JSON.
 */
const HERE = import.meta.dirname;
const FIXTURE = join(HERE, "..", "fixtures", "section-vault");
const floors = JSON.parse(readFileSync(join(HERE, "baseline.json"), "utf-8")).sections;

interface Case { id: string; tier: string; q: string; answer: string; anchor: string; copies?: string[]; pointers?: string[] }
type Table = Record<string, Record<string, SectionRow[]>>; // split -> arm -> rows

describe("Section-results eval (long runbooks, owner/copy/pointer families)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  const table: Table = {};
  const tierOf: Record<string, string> = {};

  beforeAll(async () => {
    env = await startEval(FIXTURE, "sp-section-eval-", async (dir) => { await stampDates(dir); await gitHistory(dir); }, ".documentation");
    for (const [split, file] of [["train", "golden-section.jsonl"], ["heldout", "golden-section-heldout.jsonl"]] as const) {
      const cases = parseGolden(await readFile(join(HERE, file), "utf-8")) as unknown as Case[];
      for (const arm of ["search_semantic", "search_hybrid"]) {
        const rows: SectionRow[] = [];
        for (const c of cases) {
          tierOf[c.id] = c.tier;
          const { parsed, bytes } = await env.call(arm, { query: c.q, limit: 8 });
          const paths: string[] = parsed.map((x: any) => x.path);
          const hit = parsed.find((x: any) => x.path === c.answer);
          const fromField = typeof hit?.anchor === "string";
          rows.push({
            id: c.id, rank: paths.includes(c.answer) ? paths.indexOf(c.answer) + 1 : null, wantAnchor: c.anchor, fromField, bytes,
            anchor: !hit ? null : fromField ? hit.anchor : anchorOfSnippet(env.textOf(c.answer), hit.snippet ?? ""),
            slots: paths.slice(0, 3).filter((p) => [...(c.copies ?? []), ...(c.pointers ?? [])].includes(p)).length,
          });
        }
        (table[split] ??= {})[arm] = rows;
      }
    }
    process.stderr.write("\nSection-results eval\n" + Object.entries(table).map(([s, arms]) => Object.entries(arms).map(([a, rows]) => {
      const m = summarize(rows, (id) => tierOf[id]);
      return `  ${s.padEnd(8)} ${a.padEnd(16)} doc@1=${m.docAt1}/${m.n} doc@3=${m.docAt3}/${m.n} anchor@1=${m.anchorAt1}/${m.n} anchor@3=${m.anchorAt3}/${m.n} meanBytes=${m.meanBytes}  fold: owner@1=${m.ownerAt1}/${m.foldN} owner@3=${m.ownerAt3}/${m.foldN} owner-anchor@1=${m.ownerAnchorAt1}/${m.foldN} copy+pointer slots in top 3=${m.foldSlots}`;
    }).join("\n")).join("\n") + "\n\n");
    if (process.env.EVAL_OUT) await writeFile(`${process.env.EVAL_OUT}.sections`, JSON.stringify(Object.fromEntries(Object.entries(table).map(([s, arms]) => [s, Object.fromEntries(Object.entries(arms).map(([a, rows]) => [a, { ...summarize(rows, (id) => tierOf[id]), rows }]))])), null, 2));
  }, 300_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  const m = (split: string, arm: string) => summarize(table[split][arm], (id) => tierOf[id]);

  it("the fixture keeps its size: 12 section and 4 or 2 fold cases per split, runbooks of 1,000+ lines", () => {
    expect([m("train", "search_hybrid").n, m("train", "search_hybrid").foldN]).toEqual([12, 4]);
    expect([m("heldout", "search_hybrid").n, m("heldout", "search_hybrid").foldN]).toEqual([12, 2]);
    for (const f of ["platform", "data-pipeline", "storefront"]) expect(readFileSync(join(FIXTURE, ".documentation", "operational", `${f}-runbook.md`), "utf-8").split("\n").length).toBeGreaterThan(1000);
  });

  // Real-corpus-free, but HNSW is random per build: one case of slack, as baseline.json's comment says.
  for (const s of ["train", "heldout"]) {
    for (const arm of ["search_semantic", "search_hybrid"]) {
      it(`${s}: ${arm} doc@1, doc@3 and anchor@1 never drop below the recorded floor`, () => {
        const f = floors[s][arm], r = m(s, arm);
        expect(r.docAt1).toBeGreaterThanOrEqual(f.docAt1 - 1);
        expect(r.docAt3).toBeGreaterThanOrEqual(f.docAt3 - 1);
        expect(r.anchorAt1).toBeGreaterThanOrEqual(f.anchorAt1 - 1);
      });
    }
  }

  // Phase 3 and 4 (chunking, result fields) and Phase 5 (folding) must reach these; they fail on v1.16.0 and become real gates when they start passing.
  // The 9 of 12 target was fixed before any chunking code; the semantic arm is not gated (its doc@1 is the ceiling).
  for (const s of ["train", "heldout"]) {
    it.fails(`${s}: search_hybrid names the right section (anchor@1) in at least 9 of 12 runbook questions`, () => {
      expect(m(s, "search_hybrid").anchorAt1).toBeGreaterThanOrEqual(9);
    });
    for (const arm of ["search_semantic", "search_hybrid"]) {
      it.fails(`${s}: ${arm} puts the owner first in every fold case and leaves no copy or pointer in the top 3`, () => {
        const r = m(s, arm);
        expect(r.ownerAt1).toBe(r.foldN);
        expect(r.foldSlots).toBe(0);
      });
    }
  }
});

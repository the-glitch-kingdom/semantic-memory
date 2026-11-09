import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseGolden, type FacetCase } from "./eval.js";
import { findStale } from "../../src/core/retrieval-eval/suite.js";

// Facet-check of the multi-hub sets (#76): every facet is held only by the docs the question lists as expected, so a miss is a retrieval miss and never a bad label.
const dir = join(__dirname, "../fixtures/multi-hub");
const docs = new Map(readdirSync(dir).map((f) => [`multi-hub/${f}`, readFileSync(join(dir, f), "utf-8")]));
const sets = ["multi-hub", "multi-hub-heldout"].map((n) => [n, parseGolden(readFileSync(join(__dirname, `${n}.jsonl`), "utf-8")) as unknown as FacetCase[]] as const);

describe.each(sets)("%s", (_name, cases) => {
  it("has no stale case", () => expect(findStale(cases, docs).stale).toEqual([]));
  it("has at least 12 multi questions with 3-4 facets, except two-facet ones kept as controls", () => {
    const multi = cases.filter((c) => c.tier === "multi");
    expect(multi.length).toBeGreaterThanOrEqual(12);
    expect(multi.filter((c) => (c.facets ?? []).length >= 3).length).toBeGreaterThanOrEqual(12);
  });
  it("every facet is held by expected docs only, and every expected doc holds one", () => {
    for (const c of cases) {
      const holders = new Set<string>();
      for (const f of c.facets ?? []) for (const [p, t] of docs) if (new RegExp(f, "i").test(t)) holders.add(p);
      expect([...holders].sort(), c.id).toEqual([...(c.expected ?? [])].sort());
    }
  });
  it("question text does not contain a facet, except on exact-term questions", () => {
    for (const c of cases.filter((x) => x.tier !== "exact")) for (const f of c.facets ?? []) expect(new RegExp(f, "i").test(c.q), `${c.id}: ${f}`).toBe(false);
  });
});

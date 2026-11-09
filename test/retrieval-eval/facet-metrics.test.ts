import { describe, it, expect } from "vitest";
import { grepPattern, facetRank, facetCoverage, runFacetEval, scoreLinks, invertLinks, type FacetCase } from "./eval.js";

const docs: Record<string, string> = {
  "a.md": "the retry limit is 5",
  "archive/a.md": "the retry limit is 5",
  "b.md": "dead letters go to the dlq",
};
const textOf = (p: string) => docs[p] ?? "";

describe("facetRank", () => {
  it("is the first rank where every facet is covered by live results", () => {
    expect(facetRank(["retry", "dlq"], ["a.md", "b.md"], textOf)).toBe(2);
    expect(facetRank(["retry"], ["b.md", "a.md"], textOf)).toBe(2);
  });
  it("ignores archive results", () => {
    expect(facetRank(["retry"], ["archive/a.md", "nested/archive/a.md"], textOf)).toBeNull();
  });
});

describe("runFacetEval", () => {
  it("counts answers per tier, archive hits and negative top scores", async () => {
    const cases: FacetCase[] = [
      { id: "1", tier: "exact", q: "x", facets: ["retry"] },
      { id: "2", tier: "multi", q: "y", facets: ["retry", "dlq"] },
      { id: "3", tier: "negative", q: "z" },
    ];
    const m = await runFacetEval(
      cases,
      async (q) => ({ bytes: 10, results: q === "z" ? [{ path: "b.md", score: 0.3 }] : [{ path: "archive/a.md", score: 0.9 }, { path: "a.md", score: 0.8 }, { path: "b.md", score: 0.7 }] }),
      textOf
    );
    expect(m.tiers.all).toEqual({ n: 2, at: { 1: 0, 3: 2, 8: 2 }, expandedAt1: 0, pathAt1: 0 });
    expect(m.tiers.exact.at[3]).toBe(1);
    expect(m.archiveHits).toBe(2);
    expect(m.negativeTop).toEqual([0.3]);
    expect(m.meanBytes).toBe(10);
  });
  it("averages the related neighbours on #1 over the answerable cases only", async () => {
    const cases: FacetCase[] = [
      { id: "1", tier: "exact", q: "x", facets: ["retry"] },
      { id: "2", tier: "exact", q: "y", facets: ["retry"] },
      { id: "3", tier: "negative", q: "z" },
    ];
    const m = await runFacetEval(cases, async (q) => ({ bytes: 1, results: [{ path: "a.md", score: 1 }], related: q === "x" ? ["b.md", "b.md", "b.md"] : q === "z" ? ["b.md"] : [] }), textOf);
    expect(m.relatedPerTop).toBe(1.5);
  });
});

describe("runFacetEval expected paths and latency", () => {
  it("reports found@k, MRR and latency only for cases with expected", async () => {
    const cases: FacetCase[] = [
      { id: "1", tier: "exact", q: "x", facets: ["retry"], expected: ["b.md"] },
      { id: "2", tier: "exact", q: "y", facets: ["retry"], expected: ["zzz.md"] },
      { id: "3", tier: "exact", q: "w", facets: ["retry"] },
    ];
    const m = await runFacetEval(cases, async () => ({ bytes: 1, results: [{ path: "a.md", score: 1 }, { path: "b.md", score: 0.5 }] }), textOf);
    expect(m.expectedN).toBe(2);
    expect(m.foundAt).toEqual({ 1: 0, 3: 1, 8: 1 });
    expect(m.mrr).toBe(0.25);
    expect(m.latencyMs.p95).toBeGreaterThanOrEqual(m.latencyMs.p50);
  });
});

describe("grepPattern", () => {
  it("keeps content words only", () => {
    expect(grepPattern("How does the retry limit work?")).toBe("retry|limit|work");
  });
});

describe("link scoring", () => {
  it("inverts forward links and scores precision/recall", async () => {
    const truth = { "a.md": ["b.md", "c.md"], "b.md": [] };
    expect(invertLinks(truth)).toEqual({ "a.md": [], "b.md": ["a.md"], "c.md": ["a.md"] });
    const m = await scoreLinks(truth, async (p) => (p === "a.md" ? ["b.md", "x.md"] : []));
    expect(m).toEqual({ precision: 0.5, recall: 0.5 });
  });
});

describe("cov@k and dominance", () => {
  it("facetCoverage is the share of facets some live top-k result holds", () => {
    expect(facetCoverage(["retry", "dlq"], ["a.md"], textOf)).toBe(0.5);
    expect(facetCoverage(["retry", "dlq"], ["a.md", "b.md"], textOf)).toBe(1);
    expect(facetCoverage(["retry"], ["archive/a.md"], textOf)).toBe(0);
  });
  it("reports multi facet and doc coverage per k, and the doc with the most top-3 slots on cases it does not answer", async () => {
    const cases: FacetCase[] = [
      { id: "1", tier: "multi", q: "x", facets: ["retry", "dlq"], expected: ["a.md", "b.md"] },
      { id: "2", tier: "exact", q: "y", facets: ["retry"] },
      { id: "3", tier: "negative", q: "z" },
    ];
    const m = await runFacetEval(cases, async () => ({ bytes: 1, results: [{ path: "a.md", score: 1 }, { path: "x.md", score: 1 }, { path: "x2.md", score: 1 }, { path: "b.md", score: 1 }] }), textOf);
    expect(m.cov.facet).toEqual({ 1: 0.5, 3: 0.5, 8: 1 });
    expect(m.cov.docs).toEqual({ 1: 0.5, 3: 0.5, 8: 1 });
    // a.md holds a facet of cases 1 and 2, so only case 3 (a negative) counts against it; x.md and x2.md hold nothing and take a slot on all three cases
    expect(m.dominance).toEqual({ path: "x.md", slots: 3 });
  });
});

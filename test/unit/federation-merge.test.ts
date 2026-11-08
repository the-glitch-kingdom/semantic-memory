import { describe, it, expect } from "vitest";
import { mergeSources, type SourceRun } from "../../src/core/federation-merge.js";

const item = (path: string, score: number, extra: object = {}) => ({ path, score, ...extra });
const run = (label: string, items: any[], over: Partial<SourceRun> = {}): SourceRun => ({
  label, weight: 1, bm25Min: null, ranked: items.map((i) => ({ ...i, title: i.path, snippet: "" })), items, ...over,
});

describe("mergeSources", () => {
  it("interleaves by score, labels every item and keeps each source's own order", () => {
    const out = mergeSources([run("a", [item("a1", 0.9), item("a2", 0.3)]), run("b", [item("b1", 0.6), item("b2", 0.5)])], 10);
    expect(out.map((r) => `${r.source}:${r.path}`)).toEqual(["a:a1", "b:b1", "b:b2", "a:a2"]);
  });

  it("never lets a later item of a source outrank an earlier one, and applies the weight", () => {
    // a2 has a higher raw score than a1 (a reranker or fold can do that); it still comes after a1
    const out = mergeSources([run("a", [item("a1", 0.4), item("a2", 0.8)]), run("b", [item("b1", 0.5)], { weight: 0.5 })], 10);
    expect(out.map((r) => r.path)).toEqual(["a1", "a2", "b1"]);
  });

  it("scales BM25 by each source's own selfTop instead of the query's best match", () => {
    // fused score includes 0.3 * bm25/best; a source whose best hit is far below its selfTop loses that lexical credit
    const weakLex = run("a", [item("a1", 0.7, { bm25: 1 })], { bm25Min: 8 * 0.8 });
    const strongLex = run("b", [item("b1", 0.65, { bm25: 8 })], { bm25Min: 8 * 0.8 });
    // both fused at 0.3 * 1.0 lexical; calibrated, a1 gets 0.3 * (1/8) and b1 the full 0.3
    expect(mergeSources([weakLex, strongLex], 2).map((r) => r.path)).toEqual(["b1", "a1"]);
  });

  it("keeps no_strong_match only when every answering source is weak; related and query_type only on #1", () => {
    const mixed = mergeSources(
      [run("a", [item("a1", 0.5, { no_strong_match: true, missing_terms: ["x"] })]), run("b", [item("b1", 0.4, { related: [{ path: "b2" }], query_type: "fact" })])],
      10,
    );
    expect(mixed.some((r) => "no_strong_match" in r || "missing_terms" in r)).toBe(false);
    expect(mixed[0]).not.toHaveProperty("related");
    expect(mixed[1]).not.toHaveProperty("query_type");

    const weak = mergeSources(
      [run("a", [item("a1", 0.5, { no_strong_match: true, missing_terms: ["x"], query_type: "fact" })]), run("b", [item("b1", 0.4, { no_strong_match: true })]), run("c", [])],
      10,
    );
    expect(weak.every((r) => r.no_strong_match)).toBe(true);
    expect(weak[0].missing_terms).toEqual(["x"]);
    expect(weak[0].query_type).toBe("fact");
  });

  it("stops at the limit", () => {
    expect(mergeSources([run("a", [item("a1", 0.9), item("a2", 0.8)]), run("b", [item("b1", 0.7)])], 2)).toHaveLength(2);
  });
});

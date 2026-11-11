import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bm25Index } from "../../src/core/bm25.js";
import { GraphBuilder } from "../../src/core/graph.js";
import { applyClauses, applyCoverage, DEFAULT_RANKING, loadRanking, splitClauses } from "../../src/core/rank.js";
import type { VectorIndex } from "../../src/core/vector.js";
import type { IndexedDocument } from "../../src/core/types.js";

const doc = (path: string, mdLinks: string[] = [], extra: Partial<IndexedDocument> = {}) =>
  ({ path, title: path, content: "", frontmatter: {}, wikilinks: [], mdLinks, tags: [], headers: [], chunks: [], mtime: "", ...extra }) as IndexedDocument;

describe("Bm25Index.cover", () => {
  const i = new Bm25Index();
  i.addDoc("overview.md", ["collecting readings", "alerts fire on rules", "storage keeps history"]);
  i.addDoc("narrow.md", ["alerts fire on rules and rules repeat"]);
  i.addDoc("noise.md", ["unrelated gardening"]);

  it("is the share of the query's terms anywhere in the doc, across chunks", () => {
    expect(i.cover("overview.md", "collecting alerts storage")).toBe(1);
    expect(i.cover("narrow.md", "collecting alerts storage")).toBeGreaterThan(0);
    expect(i.cover("narrow.md", "collecting alerts storage")).toBeLessThan(1);
  });
  it("weights rare terms by idf, ignores stopwords and unknown terms, and is 0 for an empty query", () => {
    expect(i.cover("narrow.md", "gardening alerts")).toBeLessThan(0.5); // has the common term, lacks the rare one
    expect(i.cover("noise.md", "gardening alerts")).toBeGreaterThan(0.5); // the reverse
    expect(i.cover("overview.md", "the of zzzunknown")).toBe(0);
    expect(i.cover("overview.md", "")).toBe(0);
    expect(i.cover("missing.md", "alerts")).toBe(0);
  });
  it("forgets a removed doc", () => {
    const j = new Bm25Index();
    j.addDoc("a.md", ["alerts"]);
    j.removeDoc("a.md");
    expect(j.cover("a.md", "alerts")).toBe(0);
  });
});

describe("applyCoverage", () => {
  const bm = new Bm25Index();
  bm.addDoc("overview.md", ["collecting readings", "alerts fire on rules", "storage keeps history"]);
  bm.addDoc("narrow.md", ["alerts fire on rules"]);
  const g = new GraphBuilder({ excludeHubs: [] });
  g.buildFromDocuments([doc("overview.md"), doc("narrow.md")]);
  const fused = [{ path: "narrow.md", score: 0.6 }, { path: "overview.md", score: 0.55 }];
  const q = "collecting alerts storage";

  it("is a no-op with the shipped defaults", () => {
    expect(DEFAULT_RANKING).toMatchObject({ coverage_weight: 0, link_prior: 1, clause_weight: 0 });
    expect(applyCoverage(fused, q, bm, g, DEFAULT_RANKING)).toBe(fused);
  });
  it("ranks the doc that covers the whole broad query above a narrower doc", () => {
    const out = applyCoverage(fused, q, bm, g, { ...DEFAULT_RANKING, coverage_weight: 0.3 });
    expect(out.map((r) => r.path)).toEqual(["overview.md", "narrow.md"]);
  });
  it("applies the link prior only from min links, not counting excluded targets or generated docs", () => {
    const hub = doc("hub.md", ["a.md", "b.md", "c.md", "gen.md"]);
    const docs = [hub, doc("a.md"), doc("b.md"), doc("c.md"), doc("gen.md", [], { generated: true }), doc("lone.md")];
    const graph = new GraphBuilder({ excludeHubs: [] });
    graph.buildFromDocuments(docs);
    const rs = [{ path: "lone.md", score: 1 }, { path: "hub.md", score: 0.95 }];
    const cfg = { ...DEFAULT_RANKING, link_prior: 1.1, link_prior_min_links: 3 };
    expect(applyCoverage(rs, "x", bm, graph, cfg)[0].path).toBe("hub.md"); // 3 live links reach the threshold (gen.md is no node)
    expect(applyCoverage(rs, "x", bm, graph, { ...cfg, link_prior_min_links: 4 })[0].path).toBe("lone.md");
    expect(applyCoverage(rs, "x", bm, graph, cfg, (p) => p === "a.md")[0].path).toBe("lone.md"); // an excluded target does not count
  });
});

describe("loadRanking", () => {
  it("reads vault.schema.yml, falls back to the defaults on a missing file or bad values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sp-rank-"));
    try {
      expect(loadRanking(dir)).toEqual(DEFAULT_RANKING);
      await writeFile(join(dir, "vault.schema.yml"), "ranking:\n  coverage_weight: 0.3\n  link_prior: -2\n  link_prior_min_links: 8\n");
      expect(loadRanking(dir)).toEqual({ coverage_weight: 0.3, link_prior: DEFAULT_RANKING.link_prior, link_prior_min_links: 8, clause_weight: DEFAULT_RANKING.clause_weight });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("clause coverage (#91 part 2)", () => {
  it("splits on and / comma / semicolon / question mark and keeps clauses with 2+ non-stop tokens", () => {
    expect(splitClauses("How do we rotate the cluster certificates, and where are the audit logs kept?")).toEqual(["How do we rotate the cluster certificates", "where are the audit logs kept"]);
    expect(splitClauses("rotate certificates; audit logs")).toHaveLength(2);
  });
  it("does nothing for a one-part question, a name with 'and', or punctuation only", () => {
    for (const q of ["How do we rotate the cluster certificates?", "Tom and Jerry", "?,;", ""]) expect(splitClauses(q)).toEqual([]);
  });
  it("caps at 3 clauses", () => {
    expect(splitClauses("alpha beta, gamma delta, epsilon zeta, eta theta")).toHaveLength(3);
  });
  it("re-ranks by the cover, and is a no-op when off or for one clause", async () => {
    const vi = { clauseCover: (p: string) => (p === "y.md" ? 0.5 : 0) } as unknown as VectorIndex;
    const embed = async () => new Float32Array(1);
    const rs = [{ path: "x.md", score: 1 }, { path: "y.md", score: 0.8 }];
    const q = "alpha beta, gamma delta";
    expect((await applyClauses(rs, q, vi, embed, { ...DEFAULT_RANKING, clause_weight: 1 }))[0].path).toBe("y.md");
    expect(await applyClauses(rs, q, vi, embed, { ...DEFAULT_RANKING, clause_weight: 0 })).toBe(rs);
    expect(await applyClauses(rs, "alpha beta", vi, embed, { ...DEFAULT_RANKING, clause_weight: 1 })).toBe(rs);
  });
});

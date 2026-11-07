import { describe, it, expect } from "vitest";
import { withConfidence, isWeak, excerpt, EXCERPT_CHARS, NO_STRONG_MATCH_BELOW } from "../../src/core/confidence.js";
import { Bm25Index, bm25Fields, bm25SelfTop, fuseScores } from "../../src/core/bm25.js";

const r = (path: string, cosine?: number, lexical?: boolean) => ({ path, title: path, score: 1, snippet: "", cosine, lexical });

describe("withConfidence", () => {
  it("is the result's own cosine: a crowd of similar hits does not lower it", () => {
    expect(withConfidence([r("a", 0.6), r("b", 0.58)])[0].confidence).toBe(0.6);
    expect(withConfidence([r("a", 0.6), r("b", 0.2)])[0].confidence).toBe(0.6);
  });

  it("the lexical arm adds a bonus; the value stays within 0..1", () => {
    const [plain] = withConfidence([r("a", 0.3, false), r("b", 0.1)]);
    const [lex] = withConfidence([r("a", 0.3, true), r("b", 0.1)]);
    expect(lex.confidence).toBeCloseTo(plain.confidence + 0.1, 2);
    expect(withConfidence([r("a", 0.95, true)])[0].confidence).toBe(1);
  });

  it("a result with no cosine (lexical-only) reads as 0", () => {
    expect(withConfidence([r("a", undefined, true)])[0].confidence).toBe(0.1);
  });
});

describe("isWeak: weak only when BOTH the cosine and the BM25 evidence are low", () => {
  const hit = (cosine?: number, bm25?: number) => ({ cosine, bm25 });
  it("low cosine and low BM25 is weak; either one strong is not", () => {
    expect(isWeak([hit(NO_STRONG_MATCH_BELOW - 0.01, 1)], 5)).toBe(true);
    expect(isWeak([hit(NO_STRONG_MATCH_BELOW, 1)], 5)).toBe(false);
    expect(isWeak([hit(0.1, 5)], 5)).toBe(false);
    expect(isWeak([hit(0.1)], 5)).toBe(true);
  });
  it("judges the best cosine and best BM25 over the whole list, not the first result", () => {
    expect(isWeak([hit(0.1, 1), hit(0.6, 0)], 5)).toBe(false);
    expect(isWeak([hit(0.1, 1), hit(0.2, 6)], 5)).toBe(false);
  });
  it("without a lexical reference the cosine alone decides; empty is not weak", () => {
    expect(isWeak([hit(0.1, 99)], null)).toBe(true);
    expect(isWeak([], 5)).toBe(false);
  });
});

describe("bm25SelfTop", () => {
  it("is the median top score of titled docs queried by their own title; null when nothing scores", () => {
    const idx = new Bm25Index();
    const docs = [{ path: "a.md", title: "Deploy pipeline rollback" }, { path: "b.md", title: "Database backup restore" }, { path: "c.md", title: "Auth token refresh" }];
    for (const d of docs) idx.addDoc(d.path, [d.title + " details about the topic"], bm25Fields(d));
    const top = bm25SelfTop(idx, docs)!;
    expect(top).toBeGreaterThan(0);
    expect(top).toBe(idx.search("Database backup restore", 1)[0].score);
    expect(bm25SelfTop(new Bm25Index(), docs)).toBeNull();
    expect(bm25SelfTop(idx, [{ path: "x.md" }])).toBeNull();
  });
});

describe("fuseScores keeps cosine and the lexical flag per doc", () => {
  it("takes cosine from the vector arm even when the lexical chunk wins the doc", () => {
    const fused = fuseScores([r("a", 0.4), r("b", 0.3)], [r("b", 4), r("a", 2)]);
    const b = fused.find((x) => x.path === "b")!;
    expect(b.cosine).toBe(0.3);
    expect(b.lexical).toBe(true);
    expect(fuseScores([r("a", 0.4)], []).find((x) => x.path === "a")!.lexical).toBeFalsy();
  });
});

describe("excerpt", () => {
  const filler = "lorem ipsum ".repeat(200);
  it("returns short text whole, whitespace collapsed", () => {
    expect(excerpt("a\n\n b", "x")).toBe("a b");
  });

  it("keeps the match span of a long chunk and stays near the limit", () => {
    const text = `${filler}the harbor.dlq topic receives poison items ${filler}`;
    const out = excerpt(text, "where does harbor.dlq go");
    expect(out).toContain("harbor.dlq");
    expect(out.length).toBeLessThanOrEqual(EXCERPT_CHARS + 2);
    expect(out.startsWith("…") && out.endsWith("…")).toBe(true);
  });

  it("starts at the beginning when no query term occurs", () => {
    const out = excerpt(`start ${filler}`, "zebra");
    expect(out.startsWith("start")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
});

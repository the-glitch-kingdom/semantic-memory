import { describe, it, expect } from "vitest";
import { withConfidence, isWeak, excerpt, EXCERPT_CHARS, NO_STRONG_MATCH_BELOW } from "../../src/core/confidence.js";
import { fuseRrf } from "../../src/core/bm25.js";

const r = (path: string, cosine?: number, lexical?: boolean) => ({ path, title: path, score: 1, snippet: "", cosine, lexical });

describe("withConfidence", () => {
  it("a lone strong hit scores above a crowd of similar ones", () => {
    const lone = withConfidence([r("a", 0.6), r("b", 0.2)])[0].confidence;
    const crowd = withConfidence([r("a", 0.6), r("b", 0.58)])[0].confidence;
    expect(lone).toBeGreaterThan(crowd);
  });

  it("the lexical arm adds a bonus; the value stays within 0..1", () => {
    const [plain] = withConfidence([r("a", 0.3, false), r("b", 0.1)]);
    const [lex] = withConfidence([r("a", 0.3, true), r("b", 0.1)]);
    expect(lex.confidence).toBeCloseTo(plain.confidence + 0.1, 2);
    expect(withConfidence([r("a", 0.95)])[0].confidence).toBe(1);
    expect(withConfidence([r("a", 0.1), r("b", 0.6)])[0].confidence).toBe(0);
  });

  it("a result with no cosine (lexical-only) reads as 0", () => {
    expect(withConfidence([r("a", undefined, true)])[0].confidence).toBe(0.1);
  });

  it("isWeak is about the top result against the threshold; empty is not weak", () => {
    expect(isWeak([{ confidence: NO_STRONG_MATCH_BELOW - 0.01 }])).toBe(true);
    expect(isWeak([{ confidence: NO_STRONG_MATCH_BELOW }])).toBe(false);
    expect(isWeak([])).toBe(false);
  });
});

describe("fuseRrf keeps cosine and the lexical flag per doc", () => {
  it("takes cosine from the vector arm even when the lexical chunk wins the doc", () => {
    const fused = fuseRrf([r("a", 0.4), r("b", 0.3)], [r("b"), r("a")]);
    const b = fused.find((x) => x.path === "b")!;
    expect(b.cosine).toBe(0.3);
    expect(b.lexical).toBe(true);
    expect(fuseRrf([r("a", 0.4)], []).find((x) => x.path === "a")!.lexical).toBe(false);
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

import { describe, it, expect } from "vitest";
import { Bm25Index, fuseRrf } from "../../src/core/bm25.js";

const r = (path: string, score = 1) => ({ path, title: path, score, snippet: "", matchedChunk: path });

describe("Bm25Index", () => {
  const build = () => {
    const i = new Bm25Index();
    i.addDoc("a.md", ["the harbor dlq receives poison messages", "unrelated text about tides"]);
    i.addDoc("b.md", ["messages are routed by topic"]);
    i.addDoc("c.md", ["nothing relevant here"]);
    return i;
  };

  it("ranks the doc with the rare matching term first, one result per doc, best chunk", () => {
    const res = build().search("poison dlq messages");
    expect(res.map((x) => x.path)).toEqual(["a.md"]); // b.md matches one of three terms: dropped as noise
    expect(res[0].matchedChunk).toContain("poison");
    expect(build().search("messages").map((x) => x.path)).toEqual(["b.md", "a.md"]); // one-term query keeps one-term hits
  });

  it("returns nothing for an empty query or unknown terms", () => {
    const i = build();
    expect(i.search("")).toEqual([]);
    expect(i.search("zzzqq")).toEqual([]);
  });

  it("updates per doc: replace and remove", () => {
    const i = build();
    i.addDoc("c.md", ["poison poison poison"]);
    expect(i.search("poison")[0].path).toBe("c.md");
    i.removeDoc("c.md");
    i.removeDoc("a.md");
    expect(i.search("poison")).toEqual([]);
    expect(i.search("messages").map((x) => x.path)).toEqual(["b.md"]);
  });
});

describe("fuseRrf", () => {
  it("rewards agreement and keeps one entry per doc", () => {
    const fused = fuseRrf([r("x"), r("y"), r("z")], [r("y"), r("w")]);
    expect(fused.map((x) => x.path)).toEqual(["y", "x", "w", "z"]);
    expect(fused.filter((x) => x.path === "y")).toHaveLength(1);
  });

  it("scores a doc ranked first by both arms at 1.0", () => {
    expect(fuseRrf([r("x")], [r("x")])[0].score).toBeCloseTo(1, 5);
  });

  it("takes the chunk from the arm that ranked the doc higher", () => {
    const v = { ...r("y"), matchedChunk: "vec" };
    const l = { ...r("y"), matchedChunk: "lex" };
    expect(fuseRrf([r("x"), v], [l])[0].matchedChunk).toBe("lex");
  });
});

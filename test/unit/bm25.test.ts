import { describe, it, expect } from "vitest";
import { Bm25Index, bm25Fields, bm25SelfTop, fuseScores } from "../../src/core/bm25.js";

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

describe("fuseScores", () => {
  it("is pure vector order when BM25 returns nothing", () => {
    const v = [r("x", 0.8), r("y", 0.6)];
    expect(fuseScores(v, [])).toEqual(v);
  });

  it("needs real lexical evidence to displace a strong vector #1, and keeps one entry per doc", () => {
    const v = [r("x", 0.8), r("y", 0.7)];
    expect(fuseScores(v, [r("x", 10), r("y", 1)]).map((a) => a.path)).toEqual(["x", "y"]);
    expect(fuseScores(v, [r("y", 5)]).map((a) => a.path)).toEqual(["y", "x"]); // a lone lexical hit is the strongest lexical evidence there is
  });

  it("scores 0.7 cosine + 0.3 scaled bm25 and flags lexical hits", () => {
    const [a, b, c] = fuseScores([r("x", 0.5), r("y", 0.6)], [r("x", 8), r("z", 4)]);
    expect([a.path, a.score]).toEqual(["x", expect.closeTo(0.65, 5)]);
    expect(a.lexical).toBe(true);
    expect([b.path, b.score]).toEqual(["y", expect.closeTo(0.42, 5)]);
    expect(b.lexical).toBeUndefined();
    expect([c.path, c.score]).toEqual(["z", expect.closeTo(0.15, 5)]);
    expect(fuseScores([r("x", 0.5)], [r("x", 3)]).length).toBe(1);
  });

  it("takes the chunk from the vector arm, the lexical one only for a doc the vector arm missed", () => {
    const v = { ...r("y", 0.5), matchedChunk: "vec" };
    const l = { ...r("y", 1), matchedChunk: "lex" };
    const out = fuseScores([v], [l, { ...r("z", 1), matchedChunk: "lexz" }]);
    expect(out.find((x) => x.path === "y")!.matchedChunk).toBe("vec");
    expect(out.find((x) => x.path === "z")!.matchedChunk).toBe("lexz");
  });
});

describe("field-aware BM25", () => {
  it("finds a doc by its title, purpose or path words without changing the returned chunk", () => {
    const i = new Bm25Index();
    i.addDoc("ops/dead-letter-queue.md", ["messages that fail go aside"], bm25Fields({ path: "ops/dead-letter-queue.md", title: "Poison handling", purpose: "quarantine" }));
    i.addDoc("other.md", ["unrelated words"]);
    for (const q of ["poison handling", "quarantine", "dead letter queue"]) expect(i.search(q).map((x) => x.path), q).toEqual(["ops/dead-letter-queue.md"]);
    expect(i.search("poison handling")[0].matchedChunk).toBe("messages that fail go aside");
  });
});

describe("bm25SelfTop with non-string titles (#51)", () => {
  it("skips a number or Date title loaded from an old index instead of throwing", () => {
    const i = new Bm25Index();
    i.addDoc("a.md", ["harbor dlq poison messages"]);
    i.addDoc("b.md", ["tides"]);
    const docs = [{ title: 2024 }, { title: new Date("2024-05-01") }, { title: "harbor dlq" }] as unknown as { title?: string }[];
    expect(bm25SelfTop(i, docs)).toBeGreaterThan(0);
  });
});

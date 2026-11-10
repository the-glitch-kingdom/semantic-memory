import { describe, it, expect } from "vitest";
import { VectorIndex } from "../../src/core/vector.js";

const vec = (seed: number) => Float32Array.from({ length: 8 }, (_, i) => Math.sin(seed * (i + 1)));
const chunk = (n: number, docPath = `d${n}.md`, chunkIndex = 0) => ({ docPath, chunkIndex, text: `t${n}` });
const make = (n: number, exactMax?: number) => {
  const v = new VectorIndex(8, 1, exactMax);
  v.build(Array.from({ length: n }, (_, i) => vec(i + 1)), Array.from({ length: n }, (_, i) => chunk(i)));
  return v;
};

describe("VectorIndex exact search", () => {
  it("returns the true top k by cosine", () => {
    const v = make(40);
    const q = vec(3.3);
    const cos = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
    const want = Array.from({ length: 40 }, (_, i) => ({ p: `d${i}.md`, c: cos(vec(i + 1), q) })).sort((a, b) => b.c - a.c).slice(0, 5);
    const got = v.search(q, 5);
    expect(got.map((r) => r.path)).toEqual(want.map((w) => w.p));
    got.forEach((r, i) => expect(r.score).toBeCloseTo(want[i].c, 5));
  });

  it("breaks ties by path whatever the insertion order", () => {
    const a = new VectorIndex(8), b = new VectorIndex(8);
    a.build([vec(1), vec(1), vec(2)], [chunk(1, "b.md"), chunk(2, "a.md"), chunk(3, "c.md")]);
    b.build([vec(2), vec(1), vec(1)], [chunk(3, "c.md"), chunk(2, "a.md"), chunk(1, "b.md")]);
    expect(a.search(vec(1), 3).map((r) => r.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(b.search(vec(1), 3).map((r) => r.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("takes the k nearest chunks, as HNSW does, not k docs", () => {
    // two chunks of a.md are nearest; at k=2 b.md must not come in, or the pool fusion sees is wider than with HNSW
    const at = (...xs: number[]) => Float32Array.from({ length: 8 }, (_, i) => xs[i] ?? 0);
    const v = new VectorIndex(8);
    v.build([at(1), at(1, 0.1), at(1, 0.5), at(0, 1)], [chunk(1, "a.md", 0), chunk(2, "a.md", 1), chunk(3, "b.md"), chunk(4, "c.md")]);
    expect(v.search(at(1), 2).map((r) => r.path)).toEqual(["a.md"]);
    expect(v.search(at(1), 3).map((r) => r.path)).toEqual(["a.md", "b.md"]);
  });

  it("handles an empty index, one chunk and a fully deleted doc", () => {
    expect(new VectorIndex(8).search(vec(1), 5)).toEqual([]);
    const one = make(1);
    expect(one.search(vec(1), 5).map((r) => r.path)).toEqual(["d0.md"]);
    one.removeDoc("d0.md");
    expect(one.search(vec(1), 5)).toEqual([]);
    const v = make(10);
    v.removeDoc("d0.md");
    expect(v.search(vec(1), 10).map((r) => r.path)).not.toContain("d0.md");
  });

  it("switches to HNSW past the threshold", () => {
    // HNSW sets ef before searching; exact search never touches it
    const ef = (v: VectorIndex): number => (v as any).index.getEf();
    const big = make(30, 20), small = make(15, 20);
    big.search(vec(1), 3);
    small.search(vec(1), 3);
    expect(ef(big)).toBe(100);
    expect(ef(small)).not.toBe(100);
  });
});

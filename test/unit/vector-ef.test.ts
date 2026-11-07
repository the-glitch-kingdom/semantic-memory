import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VectorIndex } from "../../src/core/vector.js";

const vec = (seed: number) => Float32Array.from({ length: 8 }, (_, i) => Math.sin(seed * (i + 1)));
const chunk = (n: number) => ({ docPath: `d${n}.md`, chunkIndex: 0, text: `t${n}` });
// hnswlib's ef is native state with no spy point: read it back from the wrapped index
const ef = (v: VectorIndex): number => (v as any).index.getEf();

describe("VectorIndex search ef", () => {
  it("searches at ef >= 100 after build, after incremental addChunks and after load", async () => {
    const a = new VectorIndex(8);
    a.build([vec(1), vec(2)], [chunk(1), chunk(2)]);
    a.search(vec(1), 2);
    expect(ef(a)).toBe(100);

    a.addChunks([vec(3)], [chunk(3)]);
    (a as any).index.setEf(10); // what a stale ef would be
    a.search(vec(3), 3);
    expect(ef(a)).toBe(100);

    const dir = await mkdtemp(join(tmpdir(), "sp-ef-"));
    try {
      await a.save(dir);
      const b = new VectorIndex(8);
      expect(await b.load(dir)).toBe(true);
      b.search(vec(2), 3);
      expect(ef(b)).toBe(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("raises ef above 100 for a larger k", () => {
    const n = 150;
    const idx = new VectorIndex(8);
    idx.build(Array.from({ length: n }, (_, i) => vec(i + 1)), Array.from({ length: n }, (_, i) => chunk(i)));
    idx.search(vec(1), 120);
    expect(ef(idx)).toBe(120);
  });
});

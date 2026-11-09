import { describe, it, expect } from "vitest";
import { VectorIndex } from "../../src/core/vector.js";

// one query direction; a "hub" doc has many chunks all nearer than every other doc's single chunk
const near = (jitter: number) => Float32Array.from([1, jitter, 0, 0]);
const far = (i: number) => Float32Array.from([1, 0.5 + i * 0.01, 0, 0]);

describe("VectorIndex.search counts docs, not chunks", () => {
  it("returns k distinct docs even when one doc owns the nearest chunks", () => {
    const hubChunks = 30, others = 6;
    const emb = [...Array.from({ length: hubChunks }, (_, i) => near(i * 0.0005)), ...Array.from({ length: others }, (_, i) => far(i))];
    const meta = [
      ...Array.from({ length: hubChunks }, (_, i) => ({ docPath: "hub.md", chunkIndex: i, text: `h${i}` })),
      ...Array.from({ length: others }, (_, i) => ({ docPath: `o${i}.md`, chunkIndex: 0, text: `o${i}` })),
    ];
    const idx = new VectorIndex(4);
    idx.build(emb, meta);
    const r = idx.search(near(0), 5);
    expect(r).toHaveLength(5);
    expect(new Set(r.map((x) => x.path)).size).toBe(5);
    expect(r[0].path).toBe("hub.md");
    // exhausted index: fewer docs than asked returns them all
    expect(idx.search(near(0), 50)).toHaveLength(others + 1);
  });
});

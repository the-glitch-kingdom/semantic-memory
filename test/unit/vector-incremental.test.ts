import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorIndex } from "../../src/core/vector.js";

const D = 8;
const unit = (i: number) => Float32Array.from({ length: D }, (_, j) => (j === i % D ? 1 : 0.01 * (i + 1)));
const meta = (docPath: string, chunkIndex = 0) => ({ docPath, chunkIndex, text: `${docPath}#${chunkIndex}` });

describe("VectorIndex incremental updates", () => {
  it("removes a doc's chunks from results and adds new ones past the initial capacity", () => {
    const ix = new VectorIndex(D);
    ix.build([unit(0), unit(1)], [meta("a.md"), meta("b.md")]);
    ix.removeDoc("a.md");
    expect(ix.search(unit(0), 5).map((r) => r.path)).toEqual(["b.md"]);

    const many = Array.from({ length: 40 }, (_, i) => unit(i + 2));
    ix.addChunks(many, many.map((_, i) => meta(`n${i}.md`)));
    expect(ix.search(unit(5), 3)[0].path).toBe("n3.md");
    expect(ix.getChunkMeta().length).toBe(41);
  });

  it("never returns more than the live count and survives an all-deleted index", () => {
    const ix = new VectorIndex(D);
    ix.build([unit(0)], [meta("a.md")]);
    ix.removeDoc("a.md");
    expect(ix.search(unit(0), 10)).toEqual([]);
    ix.addChunks([unit(3)], [meta("c.md")]);
    expect(ix.search(unit(3), 10).map((r) => r.path)).toEqual(["c.md"]);
  });

  it("reports the deleted ratio", () => {
    const ix = new VectorIndex(D);
    ix.build([unit(0), unit(1), unit(2), unit(3)], ["a", "b", "c", "d"].map((p) => meta(p)));
    ix.removeDoc("a");
    expect(ix.deletedRatio()).toBeCloseTo(0.25);
  });

  it("round-trips deletions through save and load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vec-"));
    try {
      const ix = new VectorIndex(D);
      ix.build([unit(0), unit(1), unit(2)], ["a", "b", "c"].map((p) => meta(p)));
      ix.removeDoc("b");
      await ix.save(dir);
      const loaded = new VectorIndex(D);
      expect(await loaded.load(dir)).toBe(true);
      expect(loaded.search(unit(1), 5).map((r) => r.path).sort()).toEqual(["a", "c"]);
      loaded.addChunks([unit(6)], [meta("d")]); // capacity restored from the file, still growable
      loaded.removeDoc("c");
      expect(loaded.search(unit(6), 5)[0].path).toBe("d");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("an index loaded past the exact threshold stays on HNSW through removeDoc and addChunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vec-"));
    try {
      const names = Array.from({ length: 30 }, (_, i) => `n${i}`);
      const ix = new VectorIndex(D);
      ix.build(names.map((_, i) => unit(i)), names.map((p) => meta(p)));
      await ix.save(dir);
      const loaded = new VectorIndex(D, 1, 20);
      await loaded.load(dir);
      for (const p of names.slice(10)) loaded.removeDoc(p); // 10 live, but 30 slots: still HNSW
      loaded.addChunks([unit(40)], [meta("fresh")]);
      expect(loaded.search(unit(40), 5).map((r) => r.path)).toContain("fresh");
      expect(loaded.search(unit(3), 20).length).toBe(11);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

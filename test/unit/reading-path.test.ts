import { describe, it, expect } from "vitest";
import { GraphBuilder } from "../../src/core/graph.js";
import { readingPath } from "../../src/core/reading-path.js";
import { VectorIndex } from "../../src/core/vector.js";
import type { IndexedDocument } from "../../src/core/types.js";

const doc = (path: string, extra: Partial<IndexedDocument> = {}): IndexedDocument =>
  ({ path, title: path, frontmatter: {}, chunks: [], ...extra }) as unknown as IndexedDocument;

function setup(docs: IndexedDocument[], edges: [string, string][], codeNodes: string[] = []) {
  const b = new GraphBuilder();
  const g = b.getGraph();
  for (const d of docs) g.addNode(d.path, { title: d.title, tags: [] });
  for (const n of codeNodes) g.addNode(n, { kind: "code", title: n, tags: [] });
  for (const [a, c] of edges) g.addEdgeWithKey(`${a}>${c}`, a, c, { type: "link", weight: 1 });
  return { b, byPath: new Map(docs.map((d) => [d.path, d])) };
}
const opts = (extra = {}) => ({ dropped: new Set<string>(), minConfidence: 0.36, skip: () => false, bestChunk: () => undefined, ...extra });
const hit = (path: string, score = 0.5) => ({ path, score, confidence: score });

describe("readingPath", () => {
  it("puts a kind: overview member first and the rest in its link order", () => {
    const docs = [doc("hit.md"), doc("ov.md", { frontmatter: { kind: "overview" }, mdLinks: ["c.md", "b.md"] }), doc("b.md"), doc("c.md")];
    const { b, byPath } = setup(docs, [["ov.md", "c.md"], ["ov.md", "b.md"], ["ov.md", "hit.md"], ["hit.md", "b.md"]]);
    expect(readingPath(b, [hit("hit.md")], byPath, opts()).map((s) => s.path)).toEqual(["ov.md", "c.md", "b.md", "hit.md"]);
  });

  it("without an overview the order is the walk's, seeds say via hit and the others name the neighbour they hang off", () => {
    const docs = [doc("a.md"), doc("b.md"), doc("c.md")];
    const { b, byPath } = setup(docs, [["a.md", "b.md"], ["b.md", "c.md"]]);
    const steps = readingPath(b, [hit("a.md")], byPath, opts());
    expect(steps.map((s) => s.path)).toEqual(["a.md", "b.md", "c.md"]); // the hit's score lifts it over b, which the bare walk ranks first
    expect(steps.find((s) => s.path === "a.md")!.via).toBe("hit");
    expect(steps.find((s) => s.path === "b.md")!.via).toBe("a.md");
  });

  it("never returns folded copies, skipped paths, low-confidence seeds or code nodes", () => {
    const docs = [doc("a.md"), doc("copy.md"), doc("old.md"), doc("b.md")];
    const { b, byPath } = setup(docs, [["a.md", "copy.md"], ["a.md", "old.md"], ["a.md", "b.md"], ["a.md", "src/x.ts"]], ["src/x.ts"]);
    const steps = readingPath(b, [hit("a.md")], byPath, opts({ dropped: new Set(["copy.md"]), skip: (p: string) => p === "old.md" }));
    expect(steps.map((s) => s.path).sort()).toEqual(["a.md", "b.md"]);
    expect(readingPath(b, [hit("a.md", 0.2)], byPath, opts())).toEqual([]);
  });

  it("is capped at five members and maps each through the doc's best section", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"].map((n) => `${n}.md`);
    const sections = [{ anchor: "setup", trail: "a.md > Setup", hash: "h" }];
    const docs = names.map((n) => doc(n, n === "a.md" ? { chunks: ["a.md > Setup\nbody"], sections, chunkSection: [0] } : {}));
    const { b, byPath } = setup(docs, names.slice(1).map((n) => ["a.md", n] as [string, string]));
    const steps = readingPath(b, [hit("a.md")], byPath, opts({ bestChunk: (p: string) => (p === "a.md" ? "a.md > Setup\nbody" : undefined) }));
    expect(steps).toHaveLength(5);
    expect(steps.find((s) => s.path === "a.md")!.section).toEqual({ anchor: "setup", trail: "Setup" });
  });
});

describe("VectorIndex.bestChunk", () => {
  it("returns the doc's body chunk nearest the query and ignores metadata chunks and other docs", () => {
    const ix = new VectorIndex(2);
    ix.build(
      [Float32Array.from([1, 0]), Float32Array.from([0, 1]), Float32Array.from([0, 1]), Float32Array.from([0, 1])],
      [{ docPath: "a.md", chunkIndex: 0, text: "x" }, { docPath: "a.md", chunkIndex: 1, text: "y" }, { docPath: "a.md", chunkIndex: 2, text: "meta", kind: "meta" }, { docPath: "b.md", chunkIndex: 0, text: "z" }],
    );
    expect(ix.bestChunk("a.md", Float32Array.from([0.1, 1]))).toBe("y");
    expect(ix.bestChunk("a.md", Float32Array.from([1, 0.1]))).toBe("x");
    expect(ix.bestChunk("none.md", Float32Array.from([1, 0]))).toBeUndefined();
  });
});

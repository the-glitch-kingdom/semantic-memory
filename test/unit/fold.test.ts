import { describe, it, expect } from "vitest";
import { fold, FOLD_MIN_CHARS } from "../../src/core/fold.js";
import type { CodeData } from "../../src/core/code-graph.js";
import type { IndexedDocument } from "../../src/core/types.js";

const body = "x".repeat(FOLD_MIN_CHARS);
const doc = (path: string, chunk: string, anchor: string, hash: string, mdLinks: string[] = []) =>
  ({ path, chunks: [chunk], sections: [{ anchor, trail: anchor, hash }], chunkSection: [0], mdLinks }) as unknown as IndexedDocument;
const hit = (path: string, score: number, chunk: string) => ({ path, score, matchedChunk: chunk });
const code = (docs: Record<string, object>): CodeData => ({ symbols: new Map(), docs: new Map(Object.entries(docs).map(([k, v]) => [k, { source: "export", refs: [], ...v }])) }) as CodeData;

describe("fold", () => {
  const docs = new Map([
    ["own.md", doc("own.md", body, "setup", "h1")],
    ["copy.md", doc("copy.md", body, "setup", "h1")],
    ["ptr.md", doc("ptr.md", "see own", "moved", "h2", ["own.md"])],
  ].map(([k, v]) => [k, v] as [string, IndexedDocument]));
  const dup = code({ "copy.md": { duplicates: [{ section: "setup", owner: "own.md", ownerAnchor: "setup" }] }, "ptr.md": { pointsTo: ["own.md"] } });

  it("the owner takes the best position and score; copy and pointer go to also_in", () => {
    const out = fold([hit("ptr.md", 0.9, "see own"), hit("copy.md", 0.8, body), hit("other.md", 0.7, "o"), hit("own.md", 0.6, body)], docs, dup);
    expect(out.map((r) => [r.path, r.score])).toEqual([["own.md", 0.9], ["other.md", 0.7]]);
    expect(out[0].also_in).toEqual(["ptr.md#moved", "copy.md#setup"]);
  });

  it("never drops a result whose owner is not in the list", () => {
    const out = fold([hit("ptr.md", 0.9, "see own"), hit("copy.md", 0.8, body)], docs, dup);
    expect(out.map((r) => r.path)).toEqual(["ptr.md", "copy.md"]);
  });

  it("a pointer-sized doc without the link, and a big section that links, both stay", () => {
    const d = new Map(docs).set("ptr.md", doc("ptr.md", "see own", "moved", "h2", []));
    expect(fold([hit("ptr.md", 0.9, "see own"), hit("own.md", 0.6, body)], d, dup).map((r) => r.path)).toEqual(["ptr.md", "own.md"]);
    const big = new Map(docs).set("ptr.md", doc("ptr.md", body + "y", "moved", "h2", ["own.md"]));
    expect(fold([hit("ptr.md", 0.9, body + "y"), hit("own.md", 0.6, body)], big, dup).map((r) => r.path)).toEqual(["ptr.md", "own.md"]);
  });

  it("without an export, identical long sections fold into the higher-ranked one; short ones do not", () => {
    const out = fold([hit("copy.md", 0.9, body), hit("own.md", 0.8, body)], docs, null);
    expect(out.map((r) => r.path)).toEqual(["copy.md"]);
    expect(out[0].also_in).toEqual(["own.md#setup"]);
    const short = new Map(["a.md", "b.md"].map((p) => [p, doc(p, "tiny", "s", "h3")] as [string, IndexedDocument]));
    expect(fold([hit("a.md", 0.9, "tiny"), hit("b.md", 0.8, "tiny")], short, null)).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { GraphBuilder } from "../../src/core/graph.js";
import type { CodeData } from "../../src/core/code-graph.js";
import type { IndexedDocument } from "../../src/core/types.js";

const doc = (path: string, extra: Partial<IndexedDocument> = {}): IndexedDocument => ({
  path, title: path, content: "", frontmatter: {}, wikilinks: [], tags: [], headers: [], chunks: [], mtime: "", ...extra,
});
const code: CodeData = {
  docs: new Map([
    ["a.md", { source: "export", refs: [
      { kind: "file", target: "scripts/guards.sh", resolved: true },
      { kind: "file", target: "gone.py", resolved: false },
      { kind: "file", target: "lib/x.ts", repo: "sibling", resolved: null },
      { kind: "symbol", target: "check_rls", resolved: null },
    ] }],
    ["b.md", { source: "code-spans", refs: [{ kind: "file", target: "scripts/guards.sh", resolved: true }] }],
  ]),
  symbols: new Map([["check_rls", { file: "backend/rls.py", citedBy: ["a.md"] }]]),
};
const docs = [doc("a.md", { mdLinks: ["b.md"] }), doc("b.md"), doc("c.md")];
const build = (c?: CodeData | null) => { const g = new GraphBuilder(); g.buildFromDocuments(docs, c); return g; };

describe("code nodes and edges", () => {
  const g = build(code);
  const types = ["link", "cites_code", "defined_in"] as const;

  it("forwardlinks(doc) lists its code, backlinks(file) lists its citers, symbols resolve by name", () => {
    expect(g.forwardlinks("a.md", [...types]).map((n) => n.path).sort()).toEqual(["b.md", "code:sibling:lib/x.ts", "code:scripts/guards.sh", "symbol:check_rls"].sort());
    expect(g.backlinks("scripts/guards.sh", [...types]).map((n) => n.path).sort()).toEqual(["a.md", "b.md"]);
    expect(g.backlinks("check_rls", [...types]).map((n) => n.path)).toEqual(["a.md"]);
    expect(g.forwardlinks("check_rls", [...types]).map((n) => n.path)).toEqual(["code:backend/rls.py"]);
  });

  it("dead refs get no node", () => {
    expect(g.backlinks("gone.py", [...types])).toEqual([]);
  });

  it("walks, paths, default links and statistics are the doc-only graph's", () => {
    const plain = build(null);
    expect(g.forwardlinks("a.md").map((n) => n.path)).toEqual(["b.md"]);
    expect(g.backlinks("scripts/guards.sh")).toEqual([]);
    expect(g.findPath("a.md", "c.md")).toBeNull();
    expect(g.findPath("a.md", "b.md")).toEqual(["a.md", "b.md"]);
    expect(g.searchGraph(["a.md"]).map((n) => n.path)).toEqual(plain.searchGraph(["a.md"]).map((n) => n.path));
    expect(g.forwardlinks("a.md", ["link"])[0]).toEqual(plain.forwardlinks("a.md")[0]);
    expect(g.statistics()).toEqual({ ...plain.statistics(), codeNodes: 4 });
    expect(plain.statistics().codeNodes).toBe(0);
  });
});

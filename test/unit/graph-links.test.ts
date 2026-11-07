import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { minimatch } from "minimatch";
import { Indexer } from "../../src/core/indexer.js";
import { GraphBuilder, loadExcludeHubs, DEFAULT_EXCLUDE_HUBS } from "../../src/core/graph.js";
import { applyGraphBoost, GRAPH_BOOST } from "../../src/core/graph-boost.js";
import { DEFAULT_PATH_CLASS_CONFIG, filterPathClass, isExcludedPath, loadPathClassConfig } from "../../src/core/path-class.js";
import type { IndexedDocument } from "../../src/core/types.js";

const doc = (path: string, extra: Partial<IndexedDocument> = {}): IndexedDocument => ({
  path, title: path, content: "", frontmatter: {}, wikilinks: [], tags: [], headers: [], chunks: [], mtime: "", ...extra,
});

describe("markdown link extraction", () => {
  let dir: string;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("resolves relative links, drops anchors, queries, externals, images, code blocks", async () => {
    dir = await mkdtemp(join(tmpdir(), "mdl-"));
    await mkdir(join(dir, "a/b"), { recursive: true });
    await writeFile(
      join(dir, "a/b/src.md"),
      [
        "[sibling](sib.md) [up](../up.md#sec) [q](q.md?x=1) [sp](my%20doc.md) [abs](/root.md)",
        "[web](https://x.org/a.md) [mail](mailto:a@b.c) [anchor](#top) [txt](notes.txt) [out](../../../x.md)",
        "![img](pic.md) [ref]: ref-target.md",
        "",
        "[def]: ../def.md",
        "",
        "```",
        "[code](in-code.md)",
        "```",
      ].join("\n")
    );
    const d = await new Indexer(dir).indexFile(join(dir, "a/b/src.md"), "a/b/src.md");
    expect(d.mdLinks!.sort()).toEqual(["a/b/sib.md", "a/def.md", "a/b/my doc.md", "a/b/q.md", "a/up.md"].sort());
  });
});

describe("typed edges", () => {
  const docs = [
    doc("a.md", { mdLinks: ["b.md"], tags: ["shared"] }),
    doc("b.md", { tags: ["shared"] }),
    doc("c.md", { wikilinks: ["a"], tags: ["shared"] }),
    doc("INDEX.md", { mdLinks: ["a.md", "b.md", "c.md"] }),
    doc("sub/REGISTRY.md", { mdLinks: ["a.md"] }),
  ];
  const g = new GraphBuilder();
  g.buildFromDocuments(docs);

  it("link edges are directed: backlinks differ from forwardlinks", () => {
    expect(g.forwardlinks("a.md").map((n) => n.path)).toEqual(["b.md"]);
    expect(g.backlinks("a.md").map((n) => n.path)).toEqual(["c.md"]);
    expect(g.forwardlinks("b.md")).toEqual([]);
  });

  it("tag neighbours only appear when asked for; hubs are not nodes", () => {
    expect(g.forwardlinks("b.md", ["tag"]).map((n) => n.path).sort()).toEqual(["a.md", "c.md"]);
    expect(g.backlinks("a.md").map((n) => n.path)).not.toContain("INDEX.md");
    expect(g.statistics().totalNodes).toBe(3);
  });

  it("findPath follows link edges, not tag edges, unless asked", () => {
    expect(g.findPath("c.md", "b.md")).toEqual(["c.md", "a.md", "b.md"]);
    expect(g.findPath("b.md", "c.md", undefined, "out")).toBeNull();
    expect(g.findPath("b.md", "c.md", ["tag"])).toEqual(["b.md", "c.md"]);
  });

  it("findPath direction: any walks against a link, in only walks against, out only forwards", () => {
    expect(g.findPath("b.md", "c.md")).toEqual(["b.md", "a.md", "c.md"]);
    expect(g.findPath("b.md", "c.md", undefined, "in")).toEqual(["b.md", "a.md", "c.md"]);
    expect(g.findPath("c.md", "b.md", undefined, "in")).toBeNull();
  });

  it("a live doc wins a wikilink over an archived copy of the same name", () => {
    const gg = new GraphBuilder({ isArchived: (p) => p.startsWith("archive/") });
    gg.buildFromDocuments([doc("x.md", { wikilinks: ["t"] }), doc("archive/t.md"), doc("live/t.md")]);
    expect(gg.forwardlinks("x.md").map((n) => n.path)).toEqual(["live/t.md"]);
  });
});

describe("applyGraphBoost", () => {
  it("boosts only link neighbours of the top 5 hits (linked hits boost each other)", () => {
    const g = new GraphBuilder();
    const names = ["s1", "s2", "s3", "s4", "s5"].map((n) => `${n}.md`);
    g.buildFromDocuments([...names.map((n) => doc(n, n === "s1.md" ? { mdLinks: ["near.md"] } : {})), doc("near.md"), doc("far.md")]);
    const ranked = [...names, "far.md", "near.md"].map((path, i) => ({ path, score: 1 - i * 0.1 }));
    const out = applyGraphBoost(ranked, g);
    expect(out.find((r) => r.path === "near.md")!.score).toBeCloseTo(0.4 * GRAPH_BOOST);
    expect(out.find((r) => r.path === "far.md")!.score).toBeCloseTo(0.5);
    expect(out.find((r) => r.path === "s1.md")!.score).toBeCloseTo(1); // a seed is not boosted by being a seed
  });

  it("changes the order when a top hit has a linked neighbour just below it", () => {
    const g = new GraphBuilder();
    g.buildFromDocuments([doc("top.md", { mdLinks: ["near.md"] }), doc("near.md"), doc("other.md")]);
    const out = applyGraphBoost([{ path: "top.md", score: 0.9 }, { path: "other.md", score: 0.5 }, { path: "near.md", score: 0.45 }], g);
    expect(out.sort((a, b) => b.score - a.score).map((r) => r.path)).toEqual(["top.md", "near.md", "other.md"]);
  });
});

describe("archive globs", () => {
  it("**/archive/** matches top-level, nested and dot-dir archives with dot:true", () => {
    for (const p of ["archive/a.md", "security/archive/a.md", ".documentation/archive/a.md", ".documentation/x/archive/deep/a.md"]) {
      expect(minimatch(p, "**/archive/**", { dot: true }), p).toBe(true);
      expect(isExcludedPath(p, DEFAULT_PATH_CLASS_CONFIG), p).toBe(true);
    }
    expect(minimatch(".documentation/archive/a.md", "**/archive/**")).toBe(false); // why dot:true is needed
    expect(isExcludedPath("architecture/archived.md", DEFAULT_PATH_CLASS_CONFIG)).toBe(false);
  });

  it("exclude drops matches; opting out keeps them but drops an archived copy of a live chunk", () => {
    const rs = [
      { path: "live.md", matchedChunk: "same" },
      { path: "archive/old.md", matchedChunk: "same" },
      { path: "archive/only.md", matchedChunk: "unique" },
    ];
    expect(filterPathClass(rs, DEFAULT_PATH_CLASS_CONFIG).map((r) => r.path)).toEqual(["live.md"]);
    expect(filterPathClass(rs, { ...DEFAULT_PATH_CLASS_CONFIG, exclude: [] }).map((r) => r.path)).toEqual(["live.md", "archive/only.md"]);
    expect(filterPathClass(rs, { ...DEFAULT_PATH_CLASS_CONFIG, enabled: false })).toHaveLength(3);
  });

  it("loads exclude from vault.schema.yml, [] opts out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pcx-"));
    try {
      await writeFile(join(dir, "vault.schema.yml"), "path_class:\n  exclude: []\n");
      expect(loadPathClassConfig(dir).exclude).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("loadExcludeHubs", () => {
  it("falls back to the default on a missing file, malformed yaml or a wrong type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hubs-"));
    try {
      expect(loadExcludeHubs(dir)).toEqual(DEFAULT_EXCLUDE_HUBS);
      await writeFile(join(dir, "vault.schema.yml"), "graph: [oops\n  : :");
      expect(loadExcludeHubs(dir)).toEqual(DEFAULT_EXCLUDE_HUBS);
      await writeFile(join(dir, "vault.schema.yml"), "graph:\n  exclude_hubs: 3\n");
      expect(loadExcludeHubs(dir)).toEqual(DEFAULT_EXCLUDE_HUBS);
      await writeFile(join(dir, "vault.schema.yml"), "graph:\n  exclude_hubs: ['**/HOME.md']\n");
      expect(loadExcludeHubs(dir)).toEqual(["**/HOME.md"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_INDEX_FIELDS, buildFields, fieldCoverage, loadIndexFields } from "../../src/core/fields.js";
import { Indexer } from "../../src/core/indexer.js";
import { GraphBuilder } from "../../src/core/graph.js";
import { VectorIndex, docChunks } from "../../src/core/vector.js";
import { Bm25Index, bm25Fields } from "../../src/core/bm25.js";
import { parserInputs } from "../../src/core/index-store.js";
import { DEFAULT_PATH_CLASS_CONFIG } from "../../src/core/path-class.js";
import type { IndexedDocument } from "../../src/core/types.js";

const cfg = DEFAULT_INDEX_FIELDS;

describe("buildFields", () => {
  const fm = {
    purpose: "Why backlog grows",
    summary: "never embedded: purpose wins",
    keywords: ["lag", "backlog"],
    tags: ["ops"],
    symptoms: [
      "plain string phrase",
      { user_phrase: "one phrase", error_pattern: "rebalance.*timed out", alert_name: "LagHigh", target: "TARGETWORD", cites: ["f1"], severity: "high" },
      { user_phrase: ["list one", "list two"] },
    ],
  };

  it("feeds every indexed field to BM25 and never target, cites or severity", () => {
    const { lexical } = buildFields(fm, "Lag playbook", cfg);
    for (const w of ["Lag playbook", "Why backlog grows", "never embedded", "lag", "backlog", "ops", "plain string phrase", "one phrase", "list one", "list two", "rebalance", "LagHigh"]) expect(lexical).toContain(w);
    for (const w of ["TARGETWORD", "f1", "high"]) expect(lexical).not.toContain(w);
  });

  it("embeds purpose and symptom phrases; error_pattern (regex) stays BM25-only; summary only stands in for a missing purpose", () => {
    const { meta } = buildFields(fm, "t", cfg);
    expect(meta.map((m) => m.text)).toEqual(["Why backlog grows", "plain string phrase", "one phrase", "LagHigh", "list one", "list two"]);
    expect(buildFields({ summary: "S", description: "D" }, "t", cfg).meta).toEqual([{ field: "summary", text: "S" }]);
    expect(buildFields({ description: "D" }, "t", cfg).meta).toEqual([{ field: "description", text: "D" }]);
  });

  it("ignores blanks, non-string values and duplicates", () => {
    expect(buildFields({ purpose: "  ", symptoms: ["", 4, { user_phrase: 3 }, "x", "x"] }, "t", cfg).meta).toEqual([{ field: "symptoms", text: "x" }]);
  });

  it("honours a custom field list", () => {
    const only = { ...cfg, lexical: ["description"], vector: [], symptom_keys: [] };
    expect(buildFields({ purpose: "p", description: "d", symptoms: ["s"] }, "t", only)).toEqual({ lexical: "d", meta: [] });
  });
});

describe("loadIndexFields", () => {
  it("defaults, overrides and bad values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "idxf-"));
    try {
      expect(loadIndexFields(dir)).toEqual(DEFAULT_INDEX_FIELDS);
      await writeFile(join(dir, "vault.schema.yml"), "index_fields:\n  vector: [summary]\n  meta_weight: 0.5\n  lexical: 3\n");
      expect(loadIndexFields(dir)).toEqual({ ...DEFAULT_INDEX_FIELDS, vector: ["summary"], meta_weight: 0.5 });
      await writeFile(join(dir, "vault.schema.yml"), "index_fields:\n  meta_weight: -1\n");
      expect(loadIndexFields(dir).meta_weight).toBe(DEFAULT_INDEX_FIELDS.meta_weight);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a field-list change re-parses, a meta_weight change does not", () => {
    const key = (f: typeof cfg) => parserInputs(DEFAULT_PATH_CLASS_CONFIG, f).join();
    expect(key({ ...cfg, meta_weight: 0.1 })).toBe(key(cfg));
    expect(key({ ...cfg, vector: ["purpose"] })).not.toBe(key(cfg));
  });
});

describe("indexing", () => {
  it("separates body chunks from metadata chunks, hides generated docs and reports coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "idxf-"));
    try {
      await mkdir(join(dir, "reports"));
      await writeFile(join(dir, "a.md"), "---\ntitle: A\npurpose: why a\nsymptoms: [it hangs]\n---\n\n# A\n\nbody text\n");
      await writeFile(join(dir, "b.md"), "# B\n\nplain body\n");
      await writeFile(join(dir, "reports", "r.md"), "---\ngenerated: true\npurpose: stock text\n---\n\n[a](../a.md)\n");
      const docs = await new Indexer(dir).indexAll();
      const [a, b, r] = ["a.md", "b.md", "reports/r.md"].map((p) => docs.find((d) => d.path === p)!);
      expect(a.chunks).toEqual([expect.stringContaining("body text")]);
      expect(a.meta).toEqual([{ field: "purpose", text: "why a" }, { field: "symptoms", text: "it hangs" }, { field: "doc", text: "A\nwhy a\nA" }]);
      expect(docChunks(a).map((c) => c.kind)).toEqual([undefined, "meta", "meta", "meta"]);
      expect(a.fieldText).toContain("it hangs");
      expect(b.meta).toEqual([{ field: "doc", text: "B\nB" }]);
      expect([r.chunks, r.meta, r.fieldText, r.generated]).toEqual([[], undefined, undefined, true]);
      // generated files are not graph nodes: no walk through them, no degree
      const g = new GraphBuilder({ excludeHubs: [] });
      g.buildFromDocuments(docs);
      expect(g.backlinks("a.md")).toEqual([]);
      expect(g.statistics().totalNodes).toBe(2);
      expect(fieldCoverage(docs, cfg)).toMatchObject({ docs: 2, fields: { purpose: 0.5, symptoms: 0.5, title: 0.5, keywords: 0 } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("BM25 finds a doc through its field text and the title wins over nothing", () => {
    const i = new Bm25Index();
    i.addDoc("x.md", ["unrelated body"], bm25Fields({ path: "x.md", fieldText: "it hangs after reindex" }));
    i.addDoc("y.md", ["other body"], bm25Fields({ path: "y.md", title: "Y", purpose: "other" }));
    expect(i.search("hangs reindex")[0].path).toBe("x.md");
  });
});

describe("VectorIndex metadata chunks", () => {
  const D = 4;
  const v = (...x: number[]) => Float32Array.from(x);
  const doc = (path: string, chunks: string[], meta: { field: string; text: string }[]) => ({ path, chunks, meta });

  const build = (weight: number) => {
    const ix = new VectorIndex(D, weight);
    // a.md: body points along x, its symptom exactly along y; b.md: body along y
    const a = docChunks(doc("a.md", ["a body"], [{ field: "symptoms", text: "a symptom" }]));
    const b = docChunks(doc("b.md", ["b body"], []));
    ix.build([v(1, 0, 0, 0), v(0, 1, 0, 0), v(0, 0.5, 0.9, 0)], [...a, ...b]);
    return ix;
  };

  it("scores a doc by max(body, meta_weight x meta) and names the field, keeping the body excerpt", () => {
    const [top] = build(0.9).search(v(0, 1, 0, 0), 5);
    expect(top.path).toBe("a.md");
    expect(top.score).toBeCloseTo(0.9);
    expect(top.matched).toEqual({ field: "symptoms", text: "a symptom" });
    expect(top.matchedChunk).toBe("a body");
  });

  it("a low weight lets a stronger body match win, with no `matched`", () => {
    const rs = build(0.1).search(v(0, 1, 0, 0), 5);
    expect(rs[0].path).toBe("b.md");
    expect(rs[0].matched).toBeUndefined();
  });

  it("round-trips the chunk kind through save and load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vx-"));
    try {
      await build(0.9).save(dir);
      const loaded = new VectorIndex(D, 0.9);
      expect(await loaded.load(dir)).toBe(true);
      expect(loaded.search(v(0, 1, 0, 0), 5)[0].matched?.field).toBe("symptoms");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("coverage", () => {
  it("counts only searchable docs", () => {
    const d = (p: string, fm: Record<string, unknown>, chunks: string[]) => ({ path: p, title: p, content: "", frontmatter: fm, wikilinks: [], tags: [], headers: [], chunks, mtime: "" }) as IndexedDocument;
    expect(fieldCoverage([d("a", { purpose: "x" }, ["t"]), d("b", {}, ["t"]), d("c", { purpose: "x" }, [])], cfg)).toMatchObject({ docs: 2, fields: { purpose: 0.5 } });
    expect(fieldCoverage([], cfg).fields.purpose).toBe(0);
  });
});

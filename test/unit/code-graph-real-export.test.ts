import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { groundDocs, loadCodeData } from "../../src/core/code-graph.js";
import { DEFAULT_DECAY_CONFIG, decayForDoc } from "../../src/core/decay.js";
import { GraphBuilder } from "../../src/core/graph.js";
import type { IndexedDocument } from "../../src/core/types.js";

/** The real `hewtd index` export (trimmed): refs of every kind, null resolved, secret and archive-candidate verdicts, many prose "dead" refs. */
const REAL = join(import.meta.dirname, "..", "fixtures", "code-graph-exports", "real-trimmed.json");

describe("the real hewtd export, end to end", () => {
  it("loads, grounds, builds the graph and ranks conservatively without a crash or a warning", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = mkdtempSync(join(tmpdir(), "real-export-"));
    try {
      const real = JSON.parse(readFileSync(REAL, "utf-8"));
      const keys = Object.keys(real.docs);
      for (const k of keys) { mkdirSync(dirname(join(root, ".documentation", k)), { recursive: true }); writeFileSync(join(root, ".documentation", k), "x"); }
      mkdirSync(join(root, ".hewtd"));
      copyFileSync(REAL, join(root, ".hewtd", "graph.json"));
      execFileSync("git", ["-C", root, "init", "-q"]);

      const docs = keys.map((path) => ({ path, title: path, content: "", frontmatter: {}, wikilinks: [], tags: [], headers: [], chunks: [], mtime: "" }) as IndexedDocument);
      const code = (await loadCodeData(join(root, ".documentation"), docs))!;
      expect(warn).not.toHaveBeenCalled();
      expect(code.docs.size).toBe(keys.length);
      expect([...code.docs.values()].every((d) => d.source === "export")).toBe(true);

      groundDocs(docs, code);
      for (const d of docs) {
        const refs = real.docs[d.path].refs;
        const dead = [...new Set(refs.filter((r: any) => r.kind === "file" && r.resolved === false).map((r: any) => posix.normalize(r.target)).filter((t: string) => t !== "./"))];
        expect(d.grounding?.dead_refs ?? [], d.path).toEqual(dead); // only file refs; null and symbol refs are never dead
        const { multiplier } = decayForDoc(d, DEFAULT_DECAY_CONFIG);
        expect(multiplier).toBeGreaterThanOrEqual(0.8 * 0.85 * 0.9); // damped: floor 0.8, archive-candidate x0.85, age decay aside
      }
      expect(docs.find((d) => d.path === "legacy/performance-tuning.md")!.grounding?.verdict).toBe("archive-candidate");
      expect(docs.find((d) => d.path === "changelog/phase-4-routing.md")!.grounding?.verdict).toBeUndefined(); // unreviewed is not reported

      const plain = new GraphBuilder(); plain.buildFromDocuments(docs);
      const g = new GraphBuilder(); g.buildFromDocuments(docs, code);
      expect(g.statistics()).toEqual({ ...plain.statistics(), codeNodes: g.statistics().codeNodes });
      expect(g.statistics().codeNodes).toBeGreaterThan(0);
      const out = g.forwardlinks("operational/lexicon-guide.md", ["cites_code", "defined_in"]).map((n) => n.path);
      expect(out.some((p) => p.startsWith("code:")) && out.some((p) => p.startsWith("symbol:"))).toBe(true);
    } finally {
      warn.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

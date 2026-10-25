import { describe, it, expect, beforeAll } from "vitest";
import { Indexer } from "../../src/core/indexer.js";
import { FIXTURES_VAULT, createTempVault, cleanupTempDir } from "../setup.js";
import { writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import type { IndexedDocument } from "../../src/core/types.js";

describe("Indexer", () => {
  let indexer: Indexer;
  let documents: IndexedDocument[];

  beforeAll(async () => {
    indexer = new Indexer(FIXTURES_VAULT);
    documents = await indexer.indexAll();
  });

  it("should find all markdown files including nested", () => {
    expect(documents.length).toBeGreaterThanOrEqual(9);
    const paths = documents.map((d) => d.path);
    expect(paths).toContain("project-overview.md");
    expect(paths).toContain("microservices.md");
    expect(paths.some((p) => p.includes("meeting-2024-01-15.md"))).toBe(true);
  });

  it("should parse frontmatter correctly", () => {
    const overview = documents.find((d) => d.path === "project-overview.md")!;
    expect(overview.frontmatter.title).toBe("Project Overview");
    expect(overview.frontmatter.tags).toEqual(["project", "overview"]);
  });

  it("should extract title from frontmatter", () => {
    const overview = documents.find((d) => d.path === "project-overview.md")!;
    expect(overview.title).toBe("Project Overview");
  });

  it("should fall back to heading for title when no frontmatter title", () => {
    const noFm = documents.find((d) => d.path === "no-frontmatter.md")!;
    expect(noFm.title).toBe("Simple Note");
  });

  it("should extract wikilinks", () => {
    const overview = documents.find((d) => d.path === "project-overview.md")!;
    expect(overview.wikilinks).toContain("microservices");
    expect(overview.wikilinks).toContain("event-driven");
    expect(overview.wikilinks).toContain("api-gateway");
  });

  it("should extract tags from both frontmatter and inline", () => {
    const overview = documents.find((d) => d.path === "project-overview.md")!;
    expect(overview.tags).toContain("project");
    expect(overview.tags).toContain("overview");
    expect(overview.tags).toContain("architecture");
    expect(overview.tags).toContain("goals");
  });

  it("should extract headers", () => {
    const overview = documents.find((d) => d.path === "project-overview.md")!;
    expect(overview.headers).toContain("Project Overview");
    expect(overview.headers).toContain("Architecture");
    expect(overview.headers).toContain("Goals");
  });

  it("should produce chunks", () => {
    const micro = documents.find((d) => d.path === "microservices.md")!;
    expect(micro.chunks.length).toBeGreaterThanOrEqual(1);
    expect(micro.chunks.every((c) => c.length > 0)).toBe(true);
  });

  it("should handle empty files", () => {
    const empty = documents.find((d) => d.path === "empty-note.md")!;
    expect(empty).toBeDefined();
    expect(empty.wikilinks).toEqual([]);
    expect(empty.tags).toEqual([]);
  });

  it("should handle files with no frontmatter", () => {
    const noFm = documents.find((d) => d.path === "no-frontmatter.md")!;
    expect(noFm).toBeDefined();
    expect(noFm.frontmatter).toEqual({});
    expect(noFm.wikilinks).toContain("project-overview");
    expect(noFm.tags).toContain("simple-tag");
  });

  describe("chunkText", () => {
    it("should return single chunk for short text", () => {
      const chunks = indexer.chunkText("Short text.");
      expect(chunks).toEqual(["Short text."]);
    });

    it("should split long text at sentence boundaries", () => {
      const longText = Array(50).fill("This is a sentence that adds length to the text.").join(" ");
      const chunks = indexer.chunkText(longText);
      expect(chunks.length).toBeGreaterThan(1);
      // No chunk should drastically exceed target
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThan(4000);
      }
    });
  });

  // issue #29 follow-on: one bad doc made indexAll reject, leaving the whole corpus unindexed
  describe("bad files", () => {
    it("indexes the body of a doc with invalid frontmatter and keeps the rest", async () => {
      const dir = await createTempVault();
      try {
        await writeFile(
          join(dir, "bad-frontmatter.md"),
          "---\ntitle: Bad\npurpose: Substrate-level: unquoted colon\n---\n\n# Bad frontmatter\n\nzebra-crossing body text\n"
        );
        const docs = await new Indexer(dir).indexAll();
        const bad = docs.find((d) => d.path === "bad-frontmatter.md");
        expect(bad).toBeDefined();
        expect(bad!.frontmatter).toEqual({});
        expect(bad!.content).toContain("zebra-crossing body text");
        expect(bad!.content).not.toContain("purpose:");
        expect(docs.length).toBeGreaterThan(1);
        // the second index in the same process (startup rebuild, watcher, reindex) must strip it too
        const again = (await new Indexer(dir).indexAll()).find((d) => d.path === "bad-frontmatter.md")!;
        expect(again.content).not.toContain("purpose:");
        expect(again.title).toBe("Bad frontmatter");
      } finally {
        await cleanupTempDir(dir);
      }
    });

    it("skips an unreadable file instead of failing the whole index", async () => {
      const dir = await createTempVault();
      try {
        const before = (await new Indexer(dir).indexAll()).length;
        await symlink(join(dir, "does-not-exist.md"), join(dir, "dangling.md"));
        const docs = await new Indexer(dir).indexAll();
        expect(docs.length).toBe(before);
      } finally {
        await cleanupTempDir(dir);
      }
    });
  });
});

import { describe, it, expect } from "vitest";
import { flatSections } from "../../src/core/sections.js";
import { flatSections as hewtdSections } from "../../node_modules/@theglitchking/hit-em-with-the-docs/dist/core/links/anchors.js";
import { Indexer } from "../../src/core/indexer.js";

const CASES: Record<string, string> = {
  repeats: "# A\n\n## Setup\nx\n## Setup\ny\n### Setup\nz\n",
  customId: "# Top\n## Deploy {#ship-it}\nbody\n## Deploy\nbody2\n",
  setext: "Title\n=====\n\nintro\n\nSub\n---\ntext\n",
  blockquote: "# Doc\n> ## Quoted heading\n> text\n",
  fences: "# Doc\n```\n# not a heading\n```\n~~~\n## nor this\n~~~\n## Real\n",
  frontmatter: "---\ntitle: x\n# yaml comment\n---\n# H\ntext\n",
  punctuation: "# `check_rls_coverage` script\n## What's [new](x.md)? (v2.0)\n## Ünïcode & more\n",
};

describe("flatSections", () => {
  for (const [name, md] of Object.entries(CASES)) {
    it(`anchors and section text match hit-em-with-the-docs: ${name}`, () => {
      const ours = flatSections(md).filter((s) => s.anchor !== "");
      const theirs = hewtdSections(md);
      expect(ours.map((s) => s.anchor)).toEqual(theirs.map((s: any) => s.anchor));
      expect(ours.map((s) => s.body.trim())).toEqual(theirs.map((s: any) => s.text.trim()));
    });
  }

  it("keeps the text before the first heading as an anchorless section, and inline code in the heading", () => {
    const s = flatSections("intro\n\n# `check_rls_coverage` script\nbody\n");
    expect(s[0]).toMatchObject({ anchor: "", body: "intro\n" });
    expect(s[1]).toMatchObject({ anchor: "check_rls_coverage-script", heading: "check_rls_coverage script" });
  });
});

describe("Indexer.sectionChunks", () => {
  const indexer = new Indexer(".");
  const long = (w: string) => `${w} `.repeat(120).trim() + ".";
  const md = `# Runbook\n\n## Deploy\n\n### Rollback\n${long("rollback")}\n\n### Database\n${long("database")}\n\n## Tiny\nshort\n\n## Last\n${long("last")}\n`;
  const plain = (indexer as any).stripMarkdown(md);

  it("prefixes each chunk with its heading trail and maps it to its section", () => {
    const { chunks, sections, chunkSection } = indexer.sectionChunks(md, plain);
    expect(chunks.map((c) => c.split("\n")[0])).toEqual(["Runbook > Deploy > Rollback", "Runbook > Deploy > Database", "Runbook > Last"]);
    expect(chunkSection.map((i) => sections[i].anchor)).toEqual(["rollback", "database", "last"]);
  });

  it("carries a section under the minimum into the next one's chunk", () => {
    const { chunks } = indexer.sectionChunks(md, plain);
    expect(chunks[2]).toContain("short");
    expect(chunks[2]).toContain("last last");
  });

  it("gives equal hashes to sections with equal text and falls back to one chunk for a doc without headings", () => {
    const twin = indexer.sectionChunks("# A\nsame   text here\n# B\nSame text HERE\n", "").sections;
    expect(twin[1].hash).toBe(twin[2].hash);
    const flat = indexer.sectionChunks("just words\n", "just words");
    expect(flat.chunks).toEqual(["just words"]);
    expect(flat.chunkSection).toEqual([0]);
  });

  it("takes a heading's text with inline code from the source", async () => {
    const tree = (indexer as any).processor.parse("# `check_rls_coverage` script\n");
    expect((indexer as any).extractHeaders(tree)).toEqual(["check_rls_coverage script"]);
  });
});

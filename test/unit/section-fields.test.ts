import { describe, it, expect } from "vitest";
import { sectionFields } from "../../src/core/section-fields.js";
import { extractSection } from "../../src/core/section.js";
import type { IndexedDocument } from "../../src/core/types.js";

const doc = {
  chunks: ["Deploy\nintro text", "Deploy > Rollback\nundo it", "plain"],
  sections: [{ anchor: "", trail: "", hash: "" }, { anchor: "deploy", trail: "Deploy", hash: "" }, { anchor: "rollback", trail: "Deploy > Rollback", hash: "", code: ["a.ts"] }],
  chunkSection: [1, 2, 0],
} as unknown as IndexedDocument;

describe("sectionFields", () => {
  it("drops the H1 when it is the title, keeps the rest, strips the trail line", () => {
    expect(sectionFields(doc, doc.chunks[1], "Deploy")).toEqual({ text: "undo it", section: "Rollback", anchor: "rollback", code: ["a.ts"] });
    expect(sectionFields(doc, doc.chunks[1], "Other")).toMatchObject({ section: "Deploy > Rollback" });
  });
  it("an H1-only section keeps its anchor but has no section; text before any heading has neither", () => {
    expect(sectionFields(doc, doc.chunks[0], "Deploy")).toEqual({ text: "intro text", anchor: "deploy" });
    expect(sectionFields(doc, doc.chunks[2], "Deploy")).toEqual({ text: "plain" });
  });
  it("an unknown chunk or doc gives the text alone", () => {
    expect(sectionFields(doc, "elsewhere", "x")).toEqual({ text: "elsewhere" });
    expect(sectionFields(undefined, "t", "x")).toEqual({ text: "t" });
  });
});

describe("extractSection by #anchor", () => {
  const md = "# A\nintro\n## B\nb text\n### C\nc text\n## B\nsecond b\n";
  it("uses hewtd anchors, repeats get -1, and runs through deeper headings", () => {
    expect(extractSection(md, "#b")).toBe("## B\nb text\n### C\nc text");
    expect(extractSection(md, "#b-1")).toBe("## B\nsecond b");
    expect(extractSection(md, "#nope")).toBeNull();
  });
  it("a heading named with a leading # still reads by name", () => {
    expect(extractSection("## # tag\nx\n", "# tag")).toBe("## # tag\nx");
  });
});

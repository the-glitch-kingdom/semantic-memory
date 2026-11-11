import { describe, it, expect } from "vitest";
import { Bm25Index } from "../../src/core/bm25.js";
import { identifierTier } from "../../src/core/identifiers.js";

const index = (docs: Record<string, string>) => {
  const b = new Bm25Index();
  for (const [p, t] of Object.entries(docs)) b.addDoc(p, [t]);
  return b;
};
const paths = (rs: { path: string }[]) => rs.map((r) => r.path);

describe("identifierTier", () => {
  const b = index({ "a.md": "exit codes", "b.md": "run check_widgets.py", "c.md": "exit zero", "d.md": "check_widgets.py and build_all.sh" });
  const rs = ["a.md", "b.md", "c.md", "d.md"].map((path) => ({ path }));

  it("holders first, each group in fused order", () => {
    expect(paths(identifierTier(rs, "what does check_widgets.py return", b))).toEqual(["b.md", "d.md", "a.md", "c.md"]);
  });
  it("several identifiers: more held first", () => {
    expect(paths(identifierTier(rs, "check_widgets.py and build_all.sh", b))).toEqual(["d.md", "b.md", "a.md", "c.md"]);
  });
  it("a name missing from the corpus changes nothing, and neither does no identifier", () => {
    expect(identifierTier(rs, "what does nothing_here.py do", b)).toBe(rs);
    expect(identifierTier(rs, "exit codes", b)).toBe(rs);
  });
  it("a missing name does not hide a present one", () => {
    expect(paths(identifierTier(rs, "nothing_here.py or build_all.sh", b))[0]).toBe("d.md");
  });
  it("every candidate holding it keeps the order", () => {
    const all = index({ "x.md": "check_widgets.py", "y.md": "check_widgets.py" });
    expect(paths(identifierTier([{ path: "y.md" }, { path: "x.md" }], "check_widgets.py", all))).toEqual(["y.md", "x.md"]);
  });
});

describe("identifierTier holds a name literally", () => {
  it("a kebab name's words scattered through a doc do not count", () => {
    const b = index({ "a.md": "the release gate passes, see the sh script", "b.md": "run gate-release.sh before tagging" });
    expect(paths(identifierTier([{ path: "a.md" }, { path: "b.md" }], "What does gate-release.sh check?", b))).toEqual(["b.md", "a.md"]);
  });
  it("the stem without its extension counts, and `-`/`_` are alike", () => {
    const b = index({ "a.md": "exit codes", "b.md": "the check-widgets script exits 2", "c.md": "build_all" });
    expect(paths(identifierTier([{ path: "a.md" }, { path: "b.md" }], "check_widgets.py exit codes", b))).toEqual(["b.md", "a.md"]);
  });
  it("a bare file name keeps its extension", () => {
    const b = index({ "a.md": "the index of results", "b.md": "edit index.ts" });
    expect(paths(identifierTier([{ path: "a.md" }, { path: "b.md" }], "what does `index.ts` export", b))).toEqual(["b.md", "a.md"]);
  });
});

import { describe, it, expect } from "vitest";
import { extractSection } from "../../src/core/section.js";

const DOC = `# Title

Intro.

## Purpose

What it is.

## Knobs & commands

- run \`reindex\`
- toggle X

### sub-knob

nested detail

## Incident log

- 2026-01-01 stuff
`;

describe("extractSection", () => {
  it("extracts a section from its heading to the next same-level heading", () => {
    const s = extractSection(DOC, "Knobs & commands")!;
    expect(s).toContain("## Knobs & commands");
    expect(s).toContain("run `reindex`");
    expect(s).toContain("### sub-knob"); // deeper heading stays in the section
    expect(s).not.toContain("Incident log"); // next same-level heading ends it
  });

  it("is case-insensitive on the heading text", () => {
    expect(extractSection(DOC, "purpose")).toContain("What it is.");
  });

  it("returns null when the heading is absent", () => {
    expect(extractSection(DOC, "Nonexistent")).toBeNull();
  });

  it("reads #anchor, and still finds a heading whose own text starts with #", () => {
    const md = "# T\n\n## Knobs\nk\n\n## #1 priority\np\n";
    expect(extractSection(md, "#knobs")).toBe("## Knobs\nk");
    expect(extractSection(md, "#1 priority")).toContain("p");
    expect(extractSection(md, "#nope")).toBeNull();
  });
});

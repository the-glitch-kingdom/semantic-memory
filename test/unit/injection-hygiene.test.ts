import { describe, it, expect } from "vitest";
import { formatContextBlock, isNonHumanPrompt, isSemanticServer } from "../../hooks/vault-context.js";

const hit = (path: string, score: number) => ({ path, score, snippet: "x" });
const countHitLines = (block: string) => (block.match(/^- `/gm) || []).length;

describe("injection hygiene (formatContextBlock)", () => {
  it("score-gates: injects nothing when the best hit is weak", () => {
    const block = formatContextBlock("prompt", "thanks", [hit("a.md", 0.2), hit("b.md", 0.19), hit("c.md", 0.15)]);
    expect(block).toBe("");
  });

  it("injects when a hit clears the threshold", () => {
    const block = formatContextBlock("prompt", "how does auth work", [hit("auth.md", 0.5)]);
    expect(block).toContain("auth.md");
  });

  it("dedupes twins by basename (keeps the first/highest, drops the copy)", () => {
    const block = formatContextBlock("prompt", "q", [
      hit("guides/x.md", 0.6),
      hit("guides/pre-restructure/x.md", 0.55),
      hit("other.md", 0.5),
    ]);
    expect(block).toContain("`guides/x.md`");
    expect(block).not.toContain("pre-restructure");
    expect(block).toContain("`other.md`");
  });

  it("caps at top-3 hits", () => {
    const block = formatContextBlock(
      "prompt",
      "q",
      ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"].map((p, i) => hit(p, 0.6 - i * 0.01))
    );
    expect(countHitLines(block)).toBe(3);
  });

  it("keeps the compact cite-or-deflect scoping (behavior preserved) but is far shorter", () => {
    const block = formatContextBlock("prompt", "q", [hit("a.md", 0.5)]);
    expect(block).toContain("project prose lookup");
    expect(block).toContain("ignore this block silently");
    expect(block).toContain('Do NOT narrate "X unrelated"');
    // The old ~150-word instructions paragraph is gone.
    expect(block).not.toContain("This block is injected on every prompt");
    const instructions = block.split("\n").find((l) => l.startsWith("Instructions:"))!;
    expect(instructions.length).toBeLessThan(320); // was ~700 chars
  });

  it("drops archive/ hits at any depth before the score gate (v1.7.2)", () => {
    const block = formatContextBlock("prompt", "q", [hit("archive/old.md", 0.9), hit("docs/archive/x.md", 0.8), hit("live.md", 0.5)]);
    expect(block).toContain("live.md");
    expect(block).not.toContain("archive/");
    expect(formatContextBlock("prompt", "q", [hit("archive/old.md", 0.9), hit("a/archive/b.md", 0.8)])).toBe("");
    expect(formatContextBlock("prompt", "q", [hit("archives/note.md", 0.5)])).toContain("archives/note.md");
  });
});

describe("prompt hook inputs (v1.7.2)", () => {
  it("treats task notifications and subagent hand-backs as non-human", () => {
    expect(isNonHumanPrompt("<task-notification>\n<task-id>b1</task-id>")).toBe(true);
    expect(isNonHumanPrompt('<agent-message from="a2b6">\n[Subagent hand-back] ...')).toBe(true);
    expect(isNonHumanPrompt("  <task-notification>")).toBe(true);
    expect(isNonHumanPrompt("<div> why does this render twice?")).toBe(false);
    expect(isNonHumanPrompt("how do I read a <task-notification>?")).toBe(false);
    expect(isNonHumanPrompt("<task-notifications are noisy")).toBe(false);
  });

  it("counts any semantic-* server that names --notes", () => {
    const e = (...args: string[]) => ({ command: "node", args });
    expect(isSemanticServer("semantic-memory-docs", e("x", "--notes", "./.documentation", "--read-only"))).toBe(true);
    expect(isSemanticServer("semantic-vault", e("--notes", "./.claude/.vault"))).toBe(true);
    expect(isSemanticServer("semantic-memory", e("x"))).toBe(false);
    expect(isSemanticServer("playwright", e("--notes", "x"))).toBe(false);
    expect(isSemanticServer("semantic-memory", undefined)).toBe(false);
  });
});

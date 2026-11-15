import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalDir } from "../../src/core/retrieval-eval/suite.js";

describe("evalDir default", () => {
  it("uses <repo root>/.claude/.semantic-memory/eval for a docs folder inside a git repo", () => {
    const repo = mkdtempSync(join(tmpdir(), "evaldir-"));
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, ".documentation"));
    expect(evalDir(join(repo, ".documentation"))).toBe(join(repo, ".claude", ".semantic-memory", "eval"));
  });

  it("keeps an eval dir the notes folder already has (pre-1.31 default)", () => {
    const repo = mkdtempSync(join(tmpdir(), "evaldir-"));
    mkdirSync(join(repo, ".git"));
    const legacy = join(repo, ".documentation", ".claude", ".semantic-memory", "eval");
    mkdirSync(legacy, { recursive: true });
    expect(evalDir(join(repo, ".documentation"))).toBe(legacy);
  });

  it("outside git, and for --dir, behaves as before", () => {
    const vault = mkdtempSync(join(tmpdir(), "evaldir-"));
    expect(evalDir(vault)).toBe(join(vault, ".claude", ".semantic-memory", "eval"));
    expect(evalDir(vault, join(vault, "x"))).toBe(join(vault, "x"));
  });
});

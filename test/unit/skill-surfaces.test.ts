import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CURRENT_TOOL_INVENTORY } from "../../src/mcp/tools/inventory.js";

const root = join(import.meta.dirname, "..", "..");
const skillsDir = join(root, "skills");

/** #81: every md/json file under skills/, so a new reference file is covered without touching this test */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(md|json)$/.test(f) ? [p] : [];
  });
}
const files = walk(skillsDir).map((p) => ({ name: relative(root, p), text: readFileSync(p, "utf-8") }));
const skill = files.find((f) => f.name === "skills/semantic-first/SKILL.md")!.text;

/** the result fields semantic-first must teach (src/mcp/tools/search.ts emits them; test/e2e/skill-result-fields.test.ts checks a live response of the same list) */
const RESULT_FIELDS = ["missing_terms", "undocumented", "passing_terms", "no_strong_match", "decay", "entity", "related"];

// verb-led snake_case or the bare graph tools: what a skill writes when it names a tool
const TOOL_LIKE = /^((search|read|list|find|create|update|delete|move|apply|synthesize|ingest|verify|manage|lint|get|log|regenerate|session|install)_[a-z_]+|forwardlinks|backlinks|reindex)$/;
const backticked = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const bareTools = (text: string) => [...new Set(backticked(text.replace(/mcp__[a-z-]+__/g, "")).filter((t) => TOOL_LIKE.test(t)))];

// Phase 2 of the #81 plan: these cases failed on 1.25.0 and are plain `it` since Phases 3-4.
describe("skills name the tools and fields the release has (#81)", () => {
  it("scans the four skills and the evals", () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["skills/semantic-first/SKILL.md", "skills/vault-first/SKILL.md", "skills/research-mode/SKILL.md", "skills/outage-silence/SKILL.md", "skills/semantic-first/evals/evals.json"]));
  });

  it("no skill hard-codes a server's tool prefix (names come from .mcp.json)", () => {
    const hits = files.filter((f) => /mcp__semantic-(sidekick|vault)__/.test(f.text)).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  it("no skill uses top_k (the parameter is limit)", () => {
    expect(files.filter((f) => /top_k/.test(f.text)).map((f) => f.name)).toEqual([]);
  });

  it("no skill names create_note: synthesize_note and ingest_source are the write path", () => {
    expect(files.filter((f) => /create_note/.test(f.text)).map((f) => f.name)).toEqual([]);
  });

  it("every tool a skill names is in CURRENT_TOOL_INVENTORY", () => {
    const known = new Set(CURRENT_TOOL_INVENTORY.map((t) => t.name));
    const unknown = files.flatMap((f) => bareTools(f.text).filter((t) => !known.has(t)).map((t) => `${f.name}: ${t}`));
    expect(unknown).toEqual([]);
    // guards the regex: it must see the draft's tools, or the check above is vacuous
    expect(bareTools(skill)).toEqual(expect.arrayContaining(["search_hybrid", "read_note"]));
  });

  it("semantic-first names the tools of the lookup and research flows", () => {
    expect(bareTools(skill)).toEqual(expect.arrayContaining(["search_hybrid", "search_text", "read_note", "forwardlinks", "backlinks", "synthesize_note", "ingest_source"]));
  });

  it("semantic-first names each result field the server emits", () => {
    const named = new Set(backticked(skill).map((t) => t.replace(/[:=].*$/, "")));
    expect(RESULT_FIELDS.filter((f) => !named.has(f))).toEqual([]);
  });

  it("semantic-first covers the indexing answer, quoted as src/mcp/context.ts prints it", () => {
    expect(readFileSync(join(root, "src/mcp/context.ts"), "utf-8")).toContain("Indexing in progress");
    expect(skill).toContain("Indexing in progress");
  });

  it("semantic-first tells the agent to cover every part of a multi-part question", () => {
    expect(skill).toMatch(/result 8/);
    expect(skill).toMatch(/every part is covered/);
  });

  it("the stale vault-frontmatter reference (tier/source/owner, which synthesize_note never writes) is gone", () => {
    expect(files.map((f) => f.name)).not.toContain("skills/semantic-first/references/vault-frontmatter.md");
  });
});

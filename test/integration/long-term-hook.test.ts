import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GEN_A, makeProject, type Project } from "../long-term-fixture.js";

// #93 Phase 7 acceptance: the prompt hook injects cold generations only on an explicit long-term request.
// The positives need the CLI's `--source long-term` (Phase 6) and the hook rule (Phase 7).
// The negatives hold today (the hook never reads cold sources) and stay as regression guards.

const ROOT = resolve(import.meta.dirname, "..", "..");
const HOOK = join(ROOT, "hooks", "vault-context.js");
const CLI = join(ROOT, "dist", "cli", "index.js");

function runHook(cwd: string, prompt: string, env: Record<string, string> = {}): string {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd, prompt }),
    encoding: "utf8",
    cwd,
    env: { ...process.env, SEMANTIC_MEMORY_INJECT_MIN_SCORE: "0.01", ...env }, // a low gate: this is about which corpora are searched
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
  return (JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext ?? "") as string;
}

describe("prompt hook and long-term memory", () => {
  let p: Project;
  beforeAll(async () => {
    p = await makeProject();
    await writeFile(join(p.root, ".mcp.json"), JSON.stringify({ mcpServers: { "semantic-memory-docs": { command: "node", args: [CLI, "--notes", "./.documentation", "--read-only"] } } }));
    const r = spawnSync("node", [CLI, "--notes", p.docs, "--reindex"], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(`reindex failed: ${r.stderr}`);
  }, 300_000);
  afterAll(() => p.cleanup());

  it.each([
    "search long-term memory for the Skerry cache stampede decision",
    "what did we do back in 2025 about the Skerry cache stampede?",
    "check the old docs for why we added request coalescing to the Skerry cache",
  ])("%s", (prompt) => {
    const ctx = runHook(p.root, prompt);
    expect(ctx).toContain('<vault-context source="long-term"');
    expect(ctx).toContain("operational/skerry-cache-stampede.md");
    expect(ctx).toContain(GEN_A);
    expect(ctx).toMatch(/past behaviou?r, not current/i);
    expect(ctx).not.toContain("deploy-credentials");
  });

  it.each([
    "our long-term plan for the Skerry cache is to keep request coalescing",
    "we need long term support for the Skerry cache",
    "back in the day the Skerry cache stampede was bad",
    "go back in the file and fix the Skerry cache stampede decision",
    "memory leak in the long-running Skerry cache worker",
    "back in 2025 we shipped the Skerry cache",
    "why did we add request coalescing to the Skerry cache stampede decision?",
  ])("never surfaces a cold generation for: %s", (prompt) => {
    const ctx = runHook(p.root, prompt);
    expect(ctx).not.toContain('source="long-term"');
    expect(ctx).not.toContain(GEN_A);
    expect(ctx).not.toMatch(/\.documentation-cold|cold-2026/);
  });
});

describe("a first long-term prompt never waits for the whole cold build", () => {
  let p: Project;
  beforeAll(async () => {
    p = await makeProject();
    await writeFile(join(p.root, ".mcp.json"), JSON.stringify({ mcpServers: { "semantic-memory-docs": { command: "node", args: [CLI, "--notes", "./.documentation", "--read-only"] } } }));
    const r = spawnSync("node", [CLI, "--notes", p.docs, "--reindex"], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(`reindex failed: ${r.stderr}`);
  }, 300_000);
  afterAll(() => p.cleanup());

  it("says it is indexing, builds in the background once, then answers", async () => {
    const prompt = "search long-term memory for the Skerry cache stampede decision";
    const t0 = Date.now();
    const first = runHook(p.root, prompt, { SEMANTIC_MEMORY_LONG_TERM_WAIT_MS: "1" });
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(first).toMatch(/being indexed for its first search/);
    expect(first).not.toContain(GEN_A);
    // a second prompt while the build runs does not start another build: no note, the default path answers
    expect(runHook(p.root, "search long-term memory for request coalescing", { SEMANTIC_MEMORY_LONG_TERM_WAIT_MS: "1" })).not.toMatch(/being indexed/);
    let ctx = "";
    for (let i = 0; i < 60 && !ctx.includes(GEN_A); i++) {
      await new Promise((r) => setTimeout(r, 2000));
      ctx = runHook(p.root, prompt.replace("decision", "decision again"));
    }
    expect(ctx).toContain('<vault-context source="long-term"');
    expect(ctx).toContain(GEN_A);
  }, 240_000);
});

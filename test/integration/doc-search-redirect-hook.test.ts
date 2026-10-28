import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// v1.7.2: the real PreToolUse hook process, as Claude Code runs it: JSON on stdin, a deny decision on stdout.
const HOOK = join(resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".."), "hooks", "doc-search-redirect.js");

describe("doc-search-redirect hook process", () => {
  let repo: string;
  const run = (input: object) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, SEMANTIC_MEMORY_DOC_SEARCH_REDIRECT: "" } });
    return { status: r.status, out: r.stdout.trim(), ms: Date.now() - t0 };
  };

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-redirect-hook-"));
    await mkdir(join(repo, ".documentation", "runbooks"), { recursive: true });
    await writeFile(join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { "semantic-memory-docs": { command: "node", args: ["x", "--notes", "./.documentation", "--read-only"] } } }));
  });
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("denies once with a reason Claude sees, lets the retry through, and stays fast", () => {
    const call = { hook_event_name: "PreToolUse", session_id: "s1", cwd: repo, tool_name: "Bash", tool_input: { command: "grep -rn rotate .documentation" } };
    const first = run(call);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.out).hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("mcp__semantic-memory-docs__search_hybrid"),
    });
    const retry = run(call);
    expect(retry).toMatchObject({ status: 0, out: "" });
    // fires on every Grep/Bash call: node start + one .mcp.json read (about 25 ms measured; generous for CI)
    expect(run({ ...call, tool_input: { command: "ls -la" } }).ms).toBeLessThan(1000);
  });

  it("fails open on bad input", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});

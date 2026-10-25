import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeJevLoop } from "../jev-fake.js";

// v1.6: the opt-in PostToolUseFailure hook injects one knowledge-base fact for a failed Bash/MCP call.
// Regression for issue #29: the `pkill -f` self-match (exit 144) fact is found from the raw failure.

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const HOOK = join(ROOT, "hooks", "vault-context.js");
const CLI = join(ROOT, "dist", "cli", "index.js");

const FACT = `---
title: pkill -f with a pattern from your own command line kills the calling shell (exit 144)
tier: fact
status: active
tags: [gotcha]
---

# pkill -f with a pattern from your own command line kills the calling shell (exit 144)

## Claim
\`pkill -f <pattern>\` matches full command lines, including the shell running the pkill itself when the
pattern appears in that command. The shell is killed and the tool call fails with Exit code 144.

## Instead
Use \`pgrep -f '[v]ite'\` style patterns, or kill by PID from a file.
`;

const failure = (over: Record<string, unknown> = {}) => ({
  hook_event_name: "PostToolUseFailure",
  tool_name: "Bash",
  tool_input: { command: "pkill -f 'vite --port 5173'; npm run dev" },
  error: "Exit code 144",
  session_id: "s1",
  ...over,
});

describe("PostToolUseFailure fact lookup (opt-in)", () => {
  let project: string;

  const run = (input: object, env: Record<string, string> = {}) => {
    const r = spawnSync("node", [HOOK], {
      input: JSON.stringify({ cwd: project, ...input }),
      encoding: "utf8",
      cwd: project,
      env: { ...process.env, SEMANTIC_MEMORY_FAILURE_HOOK: "1", SEMANTIC_MEMORY_FAILURE_MIN_SCORE: "0.2", ...env },
      timeout: 60_000,
    });
    if (r.status !== 0) throw new Error(`hook exited ${r.status}: ${r.stderr}`);
    return (JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext ?? "") as string;
  };

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), "sm-failure-hook-"));
    const docs = join(project, ".documentation");
    await mkdir(join(docs, "knowledge-base", "facts"), { recursive: true });
    await mkdir(join(docs, "guides"), { recursive: true });
    await writeFile(join(docs, "knowledge-base", "facts", "pkill-f-self-match.md"), FACT);
    await writeFile(join(docs, "guides", "dev-server.md"), "# Dev server\n\nRun the dev server with npm run dev on port 5173. Stop it with pkill.\n");
    const r = spawnSync("node", [CLI, "--notes", docs, "--reindex"], { encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(r.stderr);
    await writeFile(
      join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { "semantic-sidekick": { command: "node", args: [CLI, "--notes", "./.documentation", "--read-only"] } } })
    );
  }, 300_000);

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("is off by default: nothing without SEMANTIC_MEMORY_FAILURE_HOOK=1", () => {
    expect(run(failure({ session_id: "off" }), { SEMANTIC_MEMORY_FAILURE_HOOK: "" })).toBe("");
  });

  it("injects the pkill fact for the exit-144 failure (issue #29 regression)", () => {
    const ctx = run(failure());
    expect(ctx).toContain('<vault-fact source="tool-failure"');
    expect(ctx).toContain("knowledge-base/facts/pkill-f-self-match.md");
    expect(ctx).not.toContain("guides/dev-server.md"); // facts only
  });

  it("shows the same fact once per session, again in a new session", () => {
    expect(run(failure())).toBe(""); // s1 already saw it
    expect(run(failure({ session_id: "s2" }))).toContain("pkill-f-self-match.md");
  });

  it("stays quiet below the score threshold", () => {
    expect(run(failure({ session_id: "s3" }), { SEMANTIC_MEMORY_FAILURE_MIN_SCORE: "0.99" })).toBe("");
  });

  it("ignores interrupts, user denials and non-Bash/MCP tools", () => {
    expect(run(failure({ session_id: "s4", is_interrupt: true }))).toBe("");
    expect(run(failure({ session_id: "s5", error: "The user doesn't want to proceed with this tool use." }))).toBe("");
    expect(run(failure({ session_id: "s6", tool_name: "Read" }))).toBe("");
  });

  it("handles an MCP tool failure (no command string)", () => {
    const ctx = run(failure({ session_id: "s7", tool_name: "mcp__x__run", tool_input: { cmd: "pkill -f vite" }, error: "Exit code 144 killed" }));
    expect(ctx === "" || ctx.includes("pkill-f-self-match.md")).toBe(true); // either way it must not crash
  });

  it("is silent in outage-silence mode", async () => {
    await mkdir(join(project, ".claude", ".semantic-memory"), { recursive: true });
    const modeFile = join(project, ".claude", ".semantic-memory", "mode");
    await writeFile(modeFile, "outage-silence");
    try {
      expect(run(failure({ session_id: "s8" }))).toBe("");
    } finally {
      await writeFile(modeFile, "vault-first");
    }
  });

  it("keeps only the current session in its state file", async () => {
    run(failure({ session_id: "s9" }));
    const state = JSON.parse(await readFile(join(project, ".claude", ".semantic-memory", "failure-shown.json"), "utf8"));
    expect(Object.keys(state)).toEqual(["s9"]);
  });

  // v1.7 jev mode: the candidate fact is injected only on a clear Jev yes
  describe("jev mode gate", () => {
    let jev: { dir: string; env: NodeJS.ProcessEnv };
    const mode = (m: string) => writeFile(join(jev.dir, "mode"), m);
    const calls = async () => (await readFile(join(jev.dir, "calls.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const runJev = (input: object, env: Record<string, string> = {}) => {
      const t = Date.now();
      const r = spawnSync("node", [HOOK], {
        input: JSON.stringify({ cwd: project, ...input }),
        encoding: "utf8",
        cwd: project,
        env: { ...process.env, SEMANTIC_MEMORY_FAILURE_HOOK: "1", SEMANTIC_MEMORY_JEV: "1", JEV_LOOP_DIR: jev.dir, TYPESAFE_API_KEY: "fake", ...env },
        timeout: 60_000,
      });
      return { ctx: (JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext ?? "") as string, ms: Date.now() - t, stderr: r.stderr };
    };
    beforeAll(async () => {
      jev = await fakeJevLoop();
    });
    afterAll(async () => rm(jev.dir, { recursive: true, force: true }));

    it("Jev yes → the pkill fact is injected, marked as checked (issue #29 still found)", async () => {
      await mode("yes");
      const { ctx } = runJev(failure({ session_id: "j1" }));
      expect(ctx).toContain('checked="jev"');
      expect(ctx).toContain("pkill-f-self-match.md");
      const last = (await calls()).at(-1);
      expect(last.caller).toBe("semantic-memory-hook");
      expect(last.state).toContain("Exit code 144");
      expect(last.items).toHaveLength(1);
    });

    it("Jev no → nothing", async () => {
      await mode("no");
      expect(runJev(failure({ session_id: "j2" })).ctx).toBe("");
    });

    it("Jev error or hang → nothing, and the hook stays inside its budget", async () => {
      await mode("raise");
      expect(runJev(failure({ session_id: "j3" })).ctx).toBe("");
      await mode("sleep");
      const r = runJev(failure({ session_id: "j4" }));
      expect(r.ctx).toBe("");
      expect(r.ms).toBeLessThan(2500); // 1.5 s budget + node start-up and the reply
    });

    it("the daily ceiling: no call, one stderr note", async () => {
      await mode("yes");
      const day = new Date();
      const local = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      await writeFile(join(jev.dir, "logs", "jev-usage-x.jsonl"), JSON.stringify({ time: `${local}T00:00:01`, caller: "semantic-memory-hook", input_tokens: 10, output_tokens: 0 }) + "\n");
      const before = (await calls()).length;
      const r = runJev(failure({ session_id: "j5" }), { SEMANTIC_MEMORY_JEV_DAILY_TOKENS: "5" });
      await rm(join(jev.dir, "logs", "jev-usage-x.jsonl"));
      expect(r.ctx).toBe("");
      expect((await calls()).length).toBe(before);
      expect(r.stderr).toContain("daily ceiling reached");
    });

    it("SEMANTIC_MEMORY_FAILURE_HOOK=0 wins over jev mode", async () => {
      await mode("yes");
      const before = (await calls()).length;
      expect(runJev(failure({ session_id: "j6" }), { SEMANTIC_MEMORY_FAILURE_HOOK: "0" }).ctx).toBe("");
      expect((await calls()).length).toBe(before);
    });

    it("jev mode on but unavailable → the ungated hook (jev mode is effectively off)", async () => {
      const { ctx } = runJev(failure({ session_id: "j7" }), { JEV_LOOP_DIR: join(jev.dir, "missing") });
      expect(ctx).toContain("pkill-f-self-match.md");
      expect(ctx).not.toContain('checked="jev"');
    });
  });
});

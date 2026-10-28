import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude, fencedArgs, acquireSlot, claudeConcurrency, skillsCalled, claudeBin } from "../../src/core/claude-run.js";

export const FAKE_CLAUDE = join(resolve(fileURLToPath(new URL(".", import.meta.url)), ".."), "bin", "claude");

describe("fenced claude runs (v1.7)", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const log = async () => (await readFile(join(dir, "log.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sm-claude-run-"));
    env = { ...process.env, SEMANTIC_MEMORY_CLAUDE_BIN: FAKE_CLAUDE, SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(dir, "slots"), FAKE_CLAUDE_LOG: join(dir, "log.jsonl"), FAKE_CLAUDE_RULES: join(dir, "rules.json") };
    delete env.SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY;
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("passes the fence exactly: no hooks, no MCP, no Agent/Task, dontAsk, no session, recursion guard", async () => {
    const r = await runClaude({ prompt: "hi", cwd: dir, tools: ["Read", "Grep", "Glob"], maxTurns: 3, env });
    expect(r).toMatchObject({ ok: true, result: "ok" });
    const [run] = await log();
    const a: string[] = run.args;
    const v = (f: string) => a[a.indexOf(f) + 1];
    expect(a[0]).toBe("-p");
    expect(v("--tools")).toBe("Read,Grep,Glob");
    expect(v("--disallowedTools")).toBe("Task,Agent");
    expect(a).toContain("--strict-mcp-config");
    expect(JSON.parse(v("--settings"))).toEqual({ disableAllHooks: true });
    expect(v("--permission-mode")).toBe("dontAsk");
    expect(a).toContain("--no-session-persistence");
    expect(v("--max-turns")).toBe("3");
    expect(run.reviewer).toBe("1");
    expect(run.cwd).toBe(dir);
    expect(fencedArgs({ tools: [], maxTurns: 1 }, env)).not.toContain("Bash");
    expect(a).not.toContain("--allowedTools");
    const allowed = fencedArgs({ tools: ["Edit", "Bash"], allowedTools: ["Edit", "Bash(npm test:*)"], maxTurns: 1 }, env);
    expect(allowed[allowed.indexOf("--allowedTools") + 1]).toBe("Edit,Bash(npm test:*)");
  });

  it("reports the skills a stream-json run called", async () => {
    await writeFile(join(dir, "rules.json"), JSON.stringify([{ match: "*", skill: "restart-dev-server" }]));
    const r = await runClaude({ prompt: "restart", cwd: dir, tools: ["Skill"], maxTurns: 1, output: "stream-json", env });
    expect(skillsCalled(r.events)).toEqual(["restart-dev-server"]);
  });

  it("a missing binary, a non-JSON answer or a timeout is ok:false, never a throw", async () => {
    expect((await runClaude({ prompt: "x", cwd: dir, tools: [], maxTurns: 1, env: { ...env, SEMANTIC_MEMORY_CLAUDE_BIN: join(dir, "nope") } })).error).toContain("could not start");
    await writeFile(join(dir, "rules.json"), JSON.stringify([{ match: "*", sleepMs: 5000 }]));
    const r = await runClaude({ prompt: "x", cwd: dir, tools: [], maxTurns: 1, timeoutMs: 300, env });
    expect(r.error).toContain("timed out");
  });

  it("concurrency clamps to 1–5", () => {
    expect(claudeConcurrency({})).toBe(5);
    expect(claudeConcurrency({ SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "2" })).toBe(2);
    expect(claudeConcurrency({ SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "25" })).toBe(5);
    expect(claudeConcurrency({ SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "0" })).toBe(5);
  });

  const maxOverlap = (runs: { t0: number; t1: number }[]) =>
    Math.max(...runs.map((r) => runs.filter((o) => o.t0 < r.t1 && r.t0 < o.t1).length));

  it("12 runs never exceed 5 live claude processes", async () => {
    await writeFile(join(dir, "rules.json"), JSON.stringify([{ match: "*", sleepMs: 250 }]));
    await Promise.all(Array.from({ length: 12 }, (_, i) => runClaude({ prompt: `p${i}`, cwd: dir, tools: [], maxTurns: 1, env })));
    const runs = await log();
    expect(runs).toHaveLength(12);
    expect(maxOverlap(runs)).toBeLessThanOrEqual(5);
    expect(maxOverlap(runs)).toBeGreaterThan(1);
  });

  it("SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY=2 → never more than 2", async () => {
    await writeFile(join(dir, "rules.json"), JSON.stringify([{ match: "*", sleepMs: 150 }]));
    const two = { ...env, SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "2" };
    await Promise.all(Array.from({ length: 6 }, (_, i) => runClaude({ prompt: `p${i}`, cwd: dir, tools: [], maxTurns: 1, env: two })));
    expect(maxOverlap(await log())).toBeLessThanOrEqual(2);
  });

  it("a slot held by a dead process is reclaimed", async () => {
    const one = { ...env, SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "1" };
    await mkdir(join(dir, "slots"), { recursive: true });
    await writeFile(join(dir, "slots", "slot-0"), "999999999\n");
    const release = await acquireSlot({ env: one, timeoutMs: 2000 });
    expect(Number(await readFile(join(dir, "slots", "slot-0"), "utf8"))).toBe(process.pid);
    release();
    expect(existsSync(join(dir, "slots", "slot-0"))).toBe(false);
  });

  it("a slot held by a live process makes the next caller wait", async () => {
    const one = { ...env, SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "1" };
    const release = await acquireSlot({ env: one });
    await expect(acquireSlot({ env: one, timeoutMs: 300, pollMs: 50 })).rejects.toThrow(/no claude slot free/);
    release();
    (await acquireSlot({ env: one, timeoutMs: 300 }))();
  });
  it("1.7.1: claude is found without PATH (a worker started from cron): override, PATH, ~/.local/bin, ~/.claude/local", async () => {
    const home = join(dir, "home");
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    const exe = async (p: string) => (await mkdir(join(p, ".."), { recursive: true }), await writeFile(p, "#!/bin/sh\n"), await chmod(p, 0o755));
    const base = { HOME: home, PATH: "/nonexistent" };
    expect(claudeBin(base)).toBe("claude"); // nothing anywhere: unchanged, fails as before
    await exe(join(home, ".claude", "local", "claude"));
    expect(claudeBin(base)).toBe(join(home, ".claude", "local", "claude"));
    await exe(join(home, ".local", "bin", "claude"));
    expect(claudeBin(base)).toBe(join(home, ".local", "bin", "claude"));
    await exe(join(bin, "claude"));
    expect(claudeBin({ ...base, PATH: `/nonexistent:${bin}` })).toBe("claude");
    expect(claudeBin({ ...base, SEMANTIC_MEMORY_CLAUDE_BIN: "/opt/x/claude" })).toBe("/opt/x/claude");
  });
});

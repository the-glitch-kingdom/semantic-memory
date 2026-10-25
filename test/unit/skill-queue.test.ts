import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidence } from "../../src/core/skill-evidence.js";
import { sessionJob, enqueue, pendingJobs, recordRun, runsToday, takeLock, queueDir, logPath } from "../../src/core/skill-queue.js";
import { drain } from "../../src/core/skill-worker.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

describe("skill-loop queue and worker (v1.7)", () => {
  let repo: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  const ok = async () => ({ drafts: [], rejected: [], costUsd: 0 });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-queue-repo-"));
    home = await mkdtemp(join(tmpdir(), "sm-queue-home-"));
    await mkdir(join(repo, ".git"));
    env = { ...process.env, SEMANTIC_MEMORY_STATE_HOME: home, SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS: "10" };
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const job = (session_id: string) => {
    appendEvidence(repo, "failures", { session_id, id: `t-${session_id}`, tool: "Bash", command: "npm test", error: "Exit code 1" });
    return sessionJob(repo, { session_id, transcript_path: undefined, reason: "other" }, env)!;
  };

  it("no signal → no job; a failure, a correction or many tool calls → a job", async () => {
    expect(sessionJob(repo, { session_id: "quiet" }, env)).toBeNull();
    expect(job("s1")).toMatchObject({ session_id: "s1", repo, evidence: { failures: ["t-s1"], corrections: 0 } });
    appendEvidence(repo, "corrections", { session_id: "s2", cue: "no", excerpt: "no, use pnpm" });
    expect(sessionJob(repo, { session_id: "s2" }, env)?.reason).toContain("1 correction");
    const transcript = join(repo, "t.jsonl");
    await writeFile(transcript, Array.from({ length: 25 }, () => '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}').join("\n"));
    expect(sessionJob(repo, { session_id: "s3", transcript_path: transcript }, env)?.reason).toContain("25 tool calls");
    expect(sessionJob(repo, { session_id: "s3", transcript_path: transcript }, { ...env, SEMANTIC_MEMORY_SKILL_LOOP_MIN_TOOL_CALLS: "30" })).toBeNull();
  });

  it("drains oldest first, marks each done, and never re-reviews a done job", async () => {
    enqueue({ ...job("b"), ts: "2026-10-25T02:00:00Z" }, env);
    enqueue({ ...job("a"), ts: "2026-10-25T01:00:00Z" }, env);
    const seen: string[] = [];
    const r = await drain(repo, async (j) => (seen.push(j.session_id), ok()), env);
    expect(r).toMatchObject({ reviewed: 2, capped: false });
    expect(seen).toEqual(["a", "b"]);
    expect(pendingJobs(repo, env)).toEqual([]);
    expect((await readdir(join(queueDir(env), "done"))).sort()).toEqual(["a.json", "b.json"]);
    enqueue(job("a"), env); // the same session ending again
    expect(pendingJobs(repo, env)).toEqual([]);
    expect(await readFile(logPath(repo), "utf8")).toContain("reviewed a");
  });

  it("other repos' jobs are left alone", async () => {
    enqueue({ ...job("x"), repo: "/elsewhere" }, env);
    expect((await drain(repo, ok, env)).reviewed).toBe(0);
    expect(existsSync(join(queueDir(env), "x.json"))).toBe(true);
  });

  it("stops at the daily cap; yesterday's runs do not count", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    for (let i = 0; i < 3; i++) recordRun(repo, `old${i}`, env, yesterday);
    recordRun(repo, "today", env);
    expect(runsToday(env)).toBe(1);
    enqueue(job("c1"), env);
    enqueue(job("c2"), env);
    const r = await drain(repo, ok, { ...env, SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS: "2" });
    expect(r).toMatchObject({ reviewed: 1, capped: true });
    expect(pendingJobs(repo, env)).toHaveLength(1);
    expect(await readFile(logPath(repo), "utf8")).toContain("daily cap reached");
  });

  it("one worker per repo: a second drain finds the lock held", async () => {
    enqueue(job("l1"), env);
    let release!: () => void;
    const slow = () => new Promise<any>((r) => (release = () => r({ drafts: [], rejected: [], costUsd: 0 })));
    const first = drain(repo, slow, env);
    await new Promise((r) => setTimeout(r, 20));
    expect(await drain(repo, ok, env)).toMatchObject({ locked: true });
    release();
    expect((await first).reviewed).toBe(1);
    expect(takeLock(repo)).not.toBeNull(); // released
  });

  it("a stale lock (dead pid) is taken over", async () => {
    await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(join(repo, ".claude", ".semantic-memory", "skill-loop.lock"), "999999999\n");
    enqueue(job("st"), env);
    expect((await drain(repo, ok, env)).reviewed).toBe(1);
  });

  it("a review that throws leaves the job queued; after 3 attempts it is set aside", async () => {
    enqueue(job("bad"), env);
    const boom = async () => {
      throw new Error("claude exited 1");
    };
    for (let i = 1; i <= 2; i++) {
      expect((await drain(repo, boom, env)).failed).toBe(0);
      expect(pendingJobs(repo, env)).toHaveLength(1);
    }
    expect((await drain(repo, boom, env)).failed).toBe(1);
    expect(pendingJobs(repo, env)).toEqual([]);
    expect(existsSync(join(queueDir(env), "failed", "bad.json"))).toBe(true);
  });

  it("SessionEnd hook: with signal it writes one job fast; off or without signal, nothing", async () => {
    const { main } = await import(join(ROOT, "hooks", "skill-loop.js"));
    const end = { cwd: repo, hook_event_name: "SessionEnd", session_id: "h1", reason: "prompt_input_exit" };
    await main(end, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "" });
    appendEvidence(repo, "failures", { session_id: "h1", id: "t1", tool: "Bash", command: "x", error: "Exit code 2" });
    await main(end, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "" });
    expect(existsSync(queueDir(env))).toBe(false);
    await main({ ...end, session_id: "nothing" }, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "1" });
    expect(existsSync(join(queueDir(env), "nothing.json"))).toBe(false);
    const t = performance.now();
    // a live "worker" holds the lock, so the hook writes the job and spawns nothing
    await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(join(repo, ".claude", ".semantic-memory", "skill-loop.lock"), `${process.pid}\n`);
    await main(end, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "1" });
    expect(performance.now() - t).toBeLessThan(100);
    expect(JSON.parse(await readFile(join(queueDir(env), "h1.json"), "utf8"))).toMatchObject({ session_id: "h1", repo, reason: expect.stringContaining("prompt_input_exit") });
  });
});

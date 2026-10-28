import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidence } from "../../src/core/skill-evidence.js";
import { sessionJob, enqueue, pendingJobs, recordRun, runsToday, takeLock, queueDir, logPath, inTempDir } from "../../src/core/skill-queue.js";
import { buildBrief } from "../../src/core/skill-review.js";
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
    // test repos live in the temp dir, which the loop otherwise skips (1.7.1)
    env = { ...process.env, SEMANTIC_MEMORY_STATE_HOME: home, SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS: "10", SEMANTIC_MEMORY_SKILL_LOOP_ALLOW_TMP: "1" };
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
    const a = { ...job("a"), ts: "2026-10-25T01:00:00Z" };
    enqueue(a, env);
    const seen: string[] = [];
    const r = await drain(repo, async (j) => (seen.push(j.session_id), ok()), env);
    expect(r).toMatchObject({ reviewed: 2, capped: false });
    expect(seen).toEqual(["a", "b"]);
    expect(pendingJobs(repo, env)).toEqual([]);
    expect((await readdir(join(queueDir(env), "done"))).sort()).toEqual(["a.json", "b.json"]);
    expect(sessionJob(repo, { session_id: "a" }, env)).toBeNull(); // ended again with nothing new
    enqueue(a, env); // and its old job is not queued twice
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
  it("1.7.1: a repo in the temp directory gets no job, even with failures; ALLOW_TMP=1 or a real repo does", async () => {
    appendEvidence(repo, "failures", { session_id: "tmp1", id: "f1", tool: "Bash", command: "x", error: "Exit code 1" });
    const strict = { ...env, SEMANTIC_MEMORY_SKILL_LOOP_ALLOW_TMP: "" };
    expect(inTempDir(repo, strict)).toBe(true);
    expect(sessionJob(repo, { session_id: "tmp1" }, strict)).toBeNull();
    expect(sessionJob(repo, { session_id: "tmp1" }, env)).not.toBeNull();
    const real = await mkdtemp(join(ROOT, ".sm-queue-real-"));
    try {
      expect(inTempDir(real, strict)).toBe(false);
      appendEvidence(real, "failures", { session_id: "r1", id: "f2", tool: "Bash", command: "x", error: "Exit code 1" });
      expect(sessionJob(real, { session_id: "r1" }, strict)).not.toBeNull();
    } finally {
      await rm(real, { recursive: true, force: true });
    }
  });

  it("1.7.1: a resumed session is reviewed again only for evidence after its review", async () => {
    enqueue(job("re"), env);
    await drain(repo, ok, env);
    const first = JSON.parse(await readFile(join(queueDir(env), "done", "re.json"), "utf8"));
    // ended again with nothing new: no job, even with many tool calls in the transcript
    const transcript = join(repo, "t.jsonl");
    await writeFile(transcript, Array.from({ length: 25 }, () => '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}').join("\n"));
    expect(sessionJob(repo, { session_id: "re", transcript_path: transcript }, env)).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    appendEvidence(repo, "corrections", { session_id: "re", cue: "no", excerpt: "no, use pnpm" });
    const again = sessionJob(repo, { session_id: "re", reason: "prompt_input_exit" }, env)!;
    expect(again).toMatchObject({ since: first.finished, evidence: { failures: [], corrections: 1 } });
    expect(again.reason).toContain("resumed since its review");
    enqueue(again, env);
    expect(pendingJobs(repo, env)).toHaveLength(1);
    const seen: (string | undefined)[] = [];
    await drain(repo, async (j) => (seen.push(j.since), ok()), env);
    expect(seen).toEqual([first.finished]);
    const second = JSON.parse(await readFile(join(queueDir(env), "done", "re.json"), "utf8"));
    expect(second.finished > first.finished).toBe(true);
    expect(sessionJob(repo, { session_id: "re" }, env)).toBeNull(); // that correction is reviewed now
    enqueue({ ...again, since: "2000-01-01T00:00:00Z" }, env); // a stale follow-up job is not queued
    expect(pendingJobs(repo, env)).toEqual([]);
  });

  it("1.7.1: a follow-up brief holds only the evidence and timeline after `since`", async () => {
    const since = "2026-10-28T12:00:00.000Z";
    const ev = (kind: "failures" | "corrections", rec: object) =>
      appendEvidence(repo, kind, { session_id: "b1", ...rec }, env);
    const old = "2026-10-28T11:00:00.000Z"; // a record's own ts wins over the write time
    ev("failures", { ts: old, id: "old-f", tool: "Bash", command: "old-cmd", error: "old error" });
    ev("corrections", { ts: old, cue: "no", excerpt: "old correction" });
    ev("failures", { id: "new-f", tool: "Bash", command: "new-cmd", error: "new error" });
    const transcript = join(repo, "b1.jsonl");
    await writeFile(
      transcript,
      [
        { type: "user", timestamp: "2026-10-28T10:00:00.000Z", message: { content: "old prompt" } },
        { type: "assistant", timestamp: "2026-10-28T13:00:00.000Z", message: { content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "new-cmd" } }] } },
        { type: "user", timestamp: "2026-10-28T13:00:01.000Z", message: { content: [{ type: "tool_result", tool_use_id: "c1", is_error: true, content: "new error" }] } },
        { type: "user", timestamp: "2026-10-28T13:01:00.000Z", message: { content: "new prompt" } },
      ].map((l) => JSON.stringify(l)).join("\n"),
    );
    const brief = buildBrief({ session_id: "b1", repo, transcript_path: transcript, reason: "1 failure(s)", ts: since, since, evidence: { failures: ["new-f"], corrections: 0, skills_used: [], tool_calls: 0 } }, []);
    expect(brief).toContain("Follow-up review");
    expect(brief).toContain("new-f");
    expect(brief).toContain("USER: new prompt");
    expect(brief).toContain("TOOL Bash: new-cmd");
    for (const old of ["old-f", "old correction", "old prompt"]) expect(brief).not.toContain(old);
  });
});

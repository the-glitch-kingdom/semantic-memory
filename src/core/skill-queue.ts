/**
 * The skill loop's review queue (v1.7). SessionEnd writes one job per session that has signal and starts
 * the worker detached; the worker drains this repo's jobs oldest first, inside a global daily cap. The
 * session never waits: SessionEnd hooks get 1.5 s by default, so the hook only writes and spawns.
 *
 *   ~/.semantic-memory/review-queue/<session>.json        pending jobs (all repos)
 *   ~/.semantic-memory/review-queue/{done,failed}/         finished jobs; a resumed session is reviewed again only
 *                                                          for the failures / corrections recorded after that (`since`)
 *   ~/.semantic-memory/skill-loop-runs.jsonl               one line per review run (the daily cap)
 *   <repo>/.claude/.semantic-memory/skill-loop.lock        the repo's worker (pid)
 *   <repo>/.claude/.semantic-memory/skill-loop.log         what the worker did
 *
 * Standalone for hooks (no embedder).
 */
import { appendFileSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { readEvidence, stateDir } from "./skill-evidence.js";

export interface ReviewJob {
  session_id: string;
  repo: string;
  transcript_path: string | null;
  reason: string;
  ts: string;
  evidence: { failures: string[]; corrections: number; skills_used: string[]; tool_calls: number };
  attempts?: number;
  /** a follow-up review of a resumed session: only evidence recorded after this time (the last review's end) */
  since?: string;
}

export const smHome = (env = process.env) => env.SEMANTIC_MEMORY_STATE_HOME || join(env.HOME || homedir(), ".semantic-memory");
export const queueDir = (env = process.env) => join(smHome(env), "review-queue");
const runsPath = (env = process.env) => join(smHome(env), "skill-loop-runs.jsonl");
export const lockPath = (repo: string) => join(stateDir(repo), "skill-loop.lock");
export const logPath = (repo: string) => join(stateDir(repo), "skill-loop.log");

export const dailyRunCap = (env = process.env) => Math.max(0, Number(env.SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS ?? 10) || 0);
const minToolCalls = (env = process.env) => Number(env.SEMANTIC_MEMORY_SKILL_LOOP_MIN_TOOL_CALLS) || 20;
// shortcut: counts tool calls by scanning the transcript text; above this size the count is skipped (signal then
// needs a failure or a correction). Upgrade if long tool-only sessions should qualify.
const TRANSCRIPT_SCAN_MAX = 50 * 1024 * 1024;

const safeName = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
/** Throwaway repos (test runs, benchmarks in mkdtemp dirs) are never reviewed: they would use the daily cap. */
export function inTempDir(repo: string, env = process.env): boolean {
  if (env.SEMANTIC_MEMORY_SKILL_LOOP_ALLOW_TMP === "1") return false;
  const r = real(repo) + sep;
  return [tmpdir(), "/tmp", "/var/tmp"].some((d) => r.startsWith(real(d) + sep));
}

/** When this session's last review finished (done or failed record), or null if it was never reviewed. */
export function reviewedAt(session_id: string, env = process.env): string | null {
  let last = "";
  for (const d of ["done", "failed"]) {
    try {
      const j = JSON.parse(readFileSync(join(queueDir(env), d, `${safeName(session_id)}.json`), "utf8"));
      const at = String(j.finished || j.ts || "");
      if (at > last) last = at;
    } catch {}
  }
  return last || null;
}

function countToolCalls(transcript: string | null): number {
  if (!transcript) return 0;
  try {
    if (statSync(transcript).size > TRANSCRIPT_SCAN_MAX) return 0;
    return readFileSync(transcript, "utf8").split('"type":"tool_use"').length - 1;
  } catch {
    return 0;
  }
}

/** The job SessionEnd would write for this session, or null when the session has nothing to learn from. */
export function sessionJob(repo: string, input: { session_id?: string; transcript_path?: string; reason?: string }, env = process.env): ReviewJob | null {
  const session_id = typeof input.session_id === "string" ? input.session_id : "";
  if (!session_id || inTempDir(repo, env)) return null;
  const since = reviewedAt(session_id, env) ?? undefined;
  const mine = (r: Record<string, any>) => r.session_id === session_id && (!since || String(r.ts ?? "") > since);
  const failures = readEvidence(repo, "failures").filter(mine);
  const corrections = readEvidence(repo, "corrections").filter(mine).length;
  const skills_used = [...new Set(readEvidence(repo, "usage").filter(mine).map((u) => String(u.skill)))];
  const transcript_path = typeof input.transcript_path === "string" ? input.transcript_path : null;
  // a resumed session needs new failures or corrections: its tool-call count is mostly the reviewed part
  const tool_calls = failures.length || corrections || since ? 0 : countToolCalls(transcript_path);
  const why = failures.length ? `${failures.length} failure(s)` : corrections ? `${corrections} correction(s)` : tool_calls >= minToolCalls(env) ? `${tool_calls} tool calls` : "";
  if (!why) return null;
  return {
    ...(since ? { since } : {}),
    session_id,
    repo,
    transcript_path,
    reason: `${why}${since ? `; resumed since its review at ${since}` : ""}; ended: ${input.reason ?? "unknown"}`,
    ts: new Date().toISOString(),
    evidence: { failures: failures.map((f) => String(f.id ?? "")).filter(Boolean), corrections, skills_used, tool_calls },
  };
}

export function enqueue(job: ReviewJob, env = process.env): string {
  mkdirSync(queueDir(env), { recursive: true });
  const path = join(queueDir(env), `${safeName(job.session_id)}.json`);
  // a session that ends twice (e.g. /clear then exit) is one job; once reviewed, only a follow-up job made after
  // that review (since = its end) goes in
  const last = reviewedAt(job.session_id, env);
  if (last && (!job.since || job.since < last)) return path;
  writeFileSync(path, JSON.stringify(job, null, 1));
  return path;
}

export function pendingJobs(repo: string, env = process.env): { path: string; job: ReviewJob }[] {
  let files: string[] = [];
  try {
    files = readdirSync(queueDir(env)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const jobs: { path: string; job: ReviewJob }[] = [];
  for (const f of files) {
    try {
      const path = join(queueDir(env), f);
      const job = JSON.parse(readFileSync(path, "utf8")) as ReviewJob;
      if (job.repo === repo) jobs.push({ path, job });
    } catch {}
  }
  return jobs.sort((a, b) => a.job.ts.localeCompare(b.job.ts));
}

export function finishJob(path: string, outcome: "done" | "failed", result: Record<string, unknown>, env = process.env): void {
  const dir = join(queueDir(env), outcome);
  mkdirSync(dir, { recursive: true });
  const job = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...job, finished: new Date().toISOString(), result }, null, 1));
  renameSync(path, join(dir, path.split("/").pop()!));
}

export function bumpAttempts(path: string): number {
  const job = JSON.parse(readFileSync(path, "utf8")) as ReviewJob;
  job.attempts = (job.attempts ?? 0) + 1;
  writeFileSync(path, JSON.stringify(job, null, 1));
  return job.attempts;
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function runsToday(env = process.env, now = new Date()): number {
  try {
    const day = localDay(now);
    return readFileSync(runsPath(env), "utf8").split("\n").filter((l) => l.includes(`"day":"${day}"`)).length;
  } catch {
    return 0;
  }
}

export function recordRun(repo: string, session_id: string, env = process.env, now = new Date()): void {
  mkdirSync(smHome(env), { recursive: true });
  appendFileSync(runsPath(env), JSON.stringify({ day: localDay(now), ts: now.toISOString(), repo, session_id }) + "\n");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export function lockHolder(repo: string): number | null {
  try {
    const pid = Number(readFileSync(lockPath(repo), "utf8").trim());
    return pid && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Take the repo's worker lock (reclaiming a dead holder's). Returns a release function, or null if held. */
export function takeLock(repo: string): (() => void) | null {
  mkdirSync(stateDir(repo), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath(repo), "wx");
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return () => {
        try {
          if (Number(readFileSync(lockPath(repo), "utf8").trim()) === process.pid) unlinkSync(lockPath(repo));
        } catch {}
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (lockHolder(repo) !== null) return null;
      try {
        unlinkSync(lockPath(repo));
      } catch {}
    }
  }
  return null;
}

export function log(repo: string, line: string): void {
  try {
    mkdirSync(stateDir(repo), { recursive: true });
    appendFileSync(logPath(repo), `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

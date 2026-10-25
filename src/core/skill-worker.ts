/**
 * The skill loop's worker (v1.7): drains one repo's review queue, oldest job first, one worker per repo
 * (lock), stopping at the global daily cap (SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS, default 10). A job is
 * moved to done/ only after its review returns, so a crash leaves it queued; after 3 attempts it goes to
 * failed/ instead of retrying forever. Started detached by SessionEnd; also `semantic-memory skill-loop worker`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { bumpAttempts, dailyRunCap, finishJob, lockHolder, log, pendingJobs, recordRun, runsToday, takeLock, type ReviewJob } from "./skill-queue.js";

export interface ReviewOutcome {
  drafts: string[];
  rejected: { reason: string }[];
  costUsd: number;
  note?: string;
}

export const MAX_ATTEMPTS = 3;

export async function drain(
  repo: string,
  review: (job: ReviewJob) => Promise<ReviewOutcome>,
  env = process.env,
): Promise<{ locked: boolean; reviewed: number; capped: boolean; failed: number }> {
  const release = takeLock(repo);
  if (!release) return { locked: true, reviewed: 0, capped: false, failed: 0 };
  let reviewed = 0, failed = 0, capped = false;
  try {
    // re-read each time: SessionEnds of other sessions may add jobs while this one drains
    for (let next = pendingJobs(repo, env)[0]; next; next = pendingJobs(repo, env)[0]) {
      if (runsToday(env) >= dailyRunCap(env)) {
        capped = true;
        log(repo, `daily cap reached (${dailyRunCap(env)} reviews; SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS): ${pendingJobs(repo, env).length} job(s) wait for tomorrow`);
        break;
      }
      const attempts = bumpAttempts(next.path);
      if (attempts > MAX_ATTEMPTS) {
        finishJob(next.path, "failed", { reason: `gave up after ${MAX_ATTEMPTS} attempts` }, env);
        failed++;
        continue;
      }
      recordRun(repo, next.job.session_id, env);
      try {
        const outcome = await review(next.job);
        finishJob(next.path, "done", { ...outcome }, env);
        reviewed++;
        log(repo, `reviewed ${next.job.session_id} (${next.job.reason}): ${outcome.drafts.length} draft(s), ${outcome.rejected.length} rejected, $${outcome.costUsd.toFixed(3)}${outcome.note ? ` — ${outcome.note}` : ""}`);
      } catch (e) {
        log(repo, `review of ${next.job.session_id} failed (attempt ${attempts}): ${(e as Error).message}`);
        if (attempts >= MAX_ATTEMPTS) {
          finishJob(next.path, "failed", { reason: (e as Error).message }, env);
          failed++;
        } else break; // leave it queued for the next worker start
      }
    }
  } finally {
    release();
  }
  return { locked: false, reviewed, capped, failed };
}

/** Start `semantic-memory skill-loop worker --repo <repo>` detached, unless a live worker holds the repo's lock. */
export function spawnWorker(repo: string, env = process.env): boolean {
  if (lockHolder(repo) !== null) return false;
  // from dist/core, a dist/ chunk, or src/core (tests)
  const cli = ["../cli/index.js", "./cli/index.js", "../../dist/cli/index.js"].map((p) => fileURLToPath(new URL(p, import.meta.url))).find((p) => existsSync(p));
  if (!cli) return false;
  const child = spawn(process.execPath, [cli, "skill-loop", "worker", "--repo", repo], { cwd: repo, env, detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

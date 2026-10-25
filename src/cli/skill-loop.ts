import type { Command } from "commander";
import { resolve } from "node:path";

/** `skill-loop` subcommands beyond on / off / status (v1.7). The worker is what SessionEnd starts. */
export function registerSkillLoopCommands(program: Command) {
  const cmd = program.commands.find((c) => c.name() === "skill-loop")!;
  cmd
    .command("worker")
    .description("Drain this repo's review queue (started detached by the SessionEnd hook; safe to run by hand).")
    .option("--repo <dir>", "Repo root (default: cwd)")
    .action(async (opts) => {
      const repo = resolve(opts.repo ?? process.cwd());
      const { featureOn } = await import("../core/features.js");
      const { log } = await import("../core/skill-queue.js");
      if (!featureOn("skill_loop", repo)) {
        log(repo, "worker: skill loop is off — queue left as it is");
        process.exit(0);
      }
      const { drain } = await import("../core/skill-worker.js");
      const { reviewSession } = await import("../core/skill-review.js");
      const r = await drain(repo, (job) => reviewSession(job));
      console.log(r.locked ? "another worker holds this repo's lock" : `reviewed ${r.reviewed} session(s)${r.capped ? "; daily cap reached" : ""}${r.failed ? `; ${r.failed} set aside` : ""}`);
      process.exit(0);
    });
}

/** Extra `skill-loop status` lines: drafts waiting, today's review budget. */
export async function skillLoopStatus(cwd: string): Promise<string[]> {
  const { repoRoot } = await import("../core/skill-evidence.js");
  const { listDrafts } = await import("../core/skill-review.js");
  const { runsToday, dailyRunCap, pendingJobs, lockHolder } = await import("../core/skill-queue.js");
  const repo = repoRoot(cwd);
  const lines = [
    `drafts waiting: ${listDrafts(repo).length}${listDrafts(repo).length ? " (/skill-loop review)" : ""}`,
    `queued sessions for this repo: ${pendingJobs(repo).length}${lockHolder(repo) ? ` (worker running, pid ${lockHolder(repo)})` : ""}`,
    `reviews today (all repos): ${runsToday()} of ${dailyRunCap()} (SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS)`,
  ];
  return lines;
}

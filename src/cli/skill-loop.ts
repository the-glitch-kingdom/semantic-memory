import type { Command } from "commander";
import { resolve } from "node:path";

/** `skill-loop` subcommands beyond on / off / status (v1.7). The worker is what SessionEnd starts. */
export function registerSkillLoopCommands(program: Command) {
  const cmd = program.commands.find((c) => c.name() === "skill-loop")!;
  registerReviewCommands(cmd);
  registerCuratorCommands(cmd);
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

export function registerReviewCommands(cmd: Command) {
  cmd
    .command("review")
    .description("List skill drafts with their evidence (and diff, for patches); approve, reject or evaluate one.")
    .option("--json", "JSON output")
    .option("--approve <id>", "Land a draft (writes the skill and a ledger entry)")
    .option("--promote", "With --approve: land it as a global skill replacing the project copies (needs a promotion)")
    .option("--reject <id>", "Drop a draft (ledgered)")
    .option("--eval <id>", "Run the trigger eval on a draft and record the scores and the gate's verdict")
    .option("--task", "With --eval: also replay the task with and without the skill (runs the draft's Verify command)")
    .action(async (opts) => {
      const { repoRoot } = await import("../core/skill-evidence.js");
      const land = await import("../core/skill-land.js");
      const repo = repoRoot(process.cwd());
      try {
        if (opts.approve) {
          const e = land.approveDraft(repo, opts.approve, { promote: opts.promote });
          console.log(`✓ ${e.action}: ${e.files.map((f) => f.path).join(", ")} (ledger ${e.id}; undo: skill-loop rollback ${e.id})`);
        } else if (opts.reject) {
          const e = land.rejectDraft(repo, opts.reject);
          console.log(`✓ rejected ${e.skill} (ledger ${e.id})`);
        } else if (opts.eval) {
          const ev = await land.evalDraft(repo, opts.eval, { task: opts.task });
          console.log(opts.json ? JSON.stringify(ev, null, 2) : `gate: ${ev.gate.verdict} — ${ev.gate.reasons.join("; ")} (${ev.prompts} prompts, ${ev.runs} claude runs)`);
        } else {
          const drafts = land.describeDrafts(repo);
          if (opts.json) console.log(JSON.stringify(drafts, null, 2));
          else if (!drafts.length) console.log("no skill drafts waiting");
          else
            for (const d of drafts) {
              console.log(`\n${d.id}  ${d.kind} ${d.name} → ${d.destination}`);
              console.log(`  scope: ${d.scope}${d.scope_why ? ` (${d.scope_why})` : ""}${d.promotion?.length ? `; also in ${d.promotion.map((p) => p.repo).join(", ")}: --promote offers one global skill` : ""}`);
              console.log(`  evidence: sessions ${d.provenance?.sessions.join(", ")}; failures ${d.provenance?.failures.join(", ") || "-"}; corrections ${d.provenance?.corrections.join(", ") || "-"}`);
              if (d.verify.kind === "command") console.log(`  verify command (a --task eval runs it): ${d.verify.command}`);
              if (d.evals) console.log(`  evals: ${JSON.stringify((d.evals as any).gate)}`);
              for (const w of d.warnings) console.log(`  ! ${w}`);
            }
        }
      } catch (e) {
        console.error(`✗ ${(e as Error).message}`);
        process.exit(1);
      }
      process.exit(0);
    });
  cmd
    .command("rollback <ledger-id>")
    .description("Undo one ledgered change exactly (refuses if a file changed since).")
    .action(async (id: string) => {
      const { repoRoot } = await import("../core/skill-evidence.js");
      const { rollback } = await import("../core/skill-ledger.js");
      try {
        const e = rollback(repoRoot(process.cwd()), id);
        console.log(`✓ ${e.why} (ledger ${e.id})`);
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        process.exit(1);
      }
      process.exit(0);
    });
}

export function registerCuratorCommands(cmd: Command) {
  const repoOf = async () => (await import("../core/skill-evidence.js")).repoRoot(process.cwd());
  cmd
    .command("curate")
    .description("Mark learned skills unused 14 days stale and archive those unused 30 days (pinned / cited / new ones skipped).")
    .option("--dry-run", "Show what would change, change nothing")
    .option("--merge", "Also propose merges of overlapping learned skills as review drafts (opt-in)")
    .option("--auto", "Started by SessionStart: quiet, logs to skill-loop.log")
    .action(async (opts) => {
      const repo = await repoOf();
      const { curate } = await import("../core/skill-curator.js");
      const { log } = await import("../core/skill-queue.js");
      const r = curate(repo, { dryRun: opts.dryRun });
      const changes = r.actions.filter((a) => a.action !== "skip");
      if (opts.auto) log(repo, `curator: ${changes.map((a) => `${a.action} ${a.skill} (${a.why})`).join(", ") || "nothing to do"}`);
      else for (const a of r.actions) console.log(`${opts.dryRun ? "would " : ""}${a.action.padEnd(10)} ${a.skill} — ${a.why}`);
      if (!opts.auto && !r.actions.length) console.log("no learned skills here");
      const { consolidateOn, proposeMerges } = await import("../core/skill-merge.js");
      if (!opts.dryRun && (opts.merge || consolidateOn(repo))) {
        const m = await proposeMerges(repo);
        const line = `merge: ${m.drafted.length} draft(s) for review${m.skipped.length ? `; ${m.skipped.join("; ")}` : ""}`;
        if (opts.auto) log(repo, line);
        else console.log(line);
      }
      process.exit(0);
    });
  cmd
    .command("restore <name>")
    .description("Bring an archived learned skill back, active.")
    .action(async (name: string) => {
      const { restore } = await import("../core/skill-curator.js");
      try {
        const e = restore(await repoOf(), name);
        console.log(`✓ restored ${name} → ${e.files[0].path} (ledger ${e.id}). Pin it (skill_loop.pinned: true) to keep the curator away.`);
      } catch (err) {
        console.error(`✗ ${(err as Error).message}`);
        process.exit(1);
      }
      process.exit(0);
    });
  cmd
    .command("verify")
    .description("Run each landed learned skill's ## Verify command here; failures are flagged, nothing is archived.")
    .action(async () => {
      const { verifySkills } = await import("../core/skill-curator.js");
      const r = verifySkills(await repoOf());
      for (const x of r) console.log(`${x.result === "pass" ? "✓" : x.result === "fail" ? "✗" : "·"} ${x.skill}: ${x.result} — ${x.detail}`);
      if (!r.length) console.log("no learned skills here");
      process.exit(r.some((x) => x.result === "fail") ? 1 : 0);
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
  const { curatorState } = await import("../core/skill-curator.js");
  const st = curatorState(repo);
  lines.push(`curator: ${st.last_run ? `last run ${st.last_run.slice(0, 16)} — ${st.last_report}` : "not run yet (first run 7 days after the loop first sees a repo)"}`);
  if (st.flagged?.length) lines.push(`verify failures flagged: ${st.flagged.map((f) => f.name).join(", ")}`);
  return lines;
}

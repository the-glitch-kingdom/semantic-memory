#!/usr/bin/env node
// skill-loop.js — the skill loop's hooks (v1.7). Off by default: with the skill loop off (or inside a
// skill-loop claude run) every event leaves at once, writes nothing and spawns nothing.
//
//   SessionStart                → once per session (startup / resume): what auto mode changed since the last report,
//                                 "N skill drafts waiting", "N suggested changes to hand-written skills"; starts the curator
//                                 detached when it is due (every 7 days, repo quiet >= 2 h)
//   PostToolUse (matcher Skill) → one usage line in .claude/.semantic-memory/skill-usage.jsonl
//   SessionEnd                  → a review job when the session has signal (a failure, a correction or many
//                                 tool calls), and the repo's worker started detached. Must finish well inside
//                                 SessionEnd's 1.5 s: it only writes the job and spawns.
//
// Never blocks the session and never fails it: errors are swallowed (SIDEKICK_DEBUG=1 prints them).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEBUG = process.env.SIDEKICK_DEBUG === "1";
const debug = (msg) => DEBUG && process.stderr.write(`[skill-loop] ${msg}\n`);
const dist = (m) => new URL(`../dist/core/${m}.js`, import.meta.url).href;

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function main(input = readStdinJson(), env = process.env) {
  if (env.SEMANTIC_MEMORY_REVIEWER === "1") return;
  const cwd = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const { featureOn } = await import(dist("features"));
  if (!featureOn("skill_loop", cwd, env)) return;
  const ev = await import(dist("skill-evidence"));
  const root = ev.repoRoot(cwd);
  const session_id = typeof input.session_id === "string" ? input.session_id : null;
  if (input.hook_event_name === "SessionStart") {
    if (input.source === "clear" || input.source === "compact") return;
    const { listDrafts } = await import(dist("skill-review"));
    const drafts = listDrafts(root);
    const suggestions = drafts.filter((d) => d.record.kind === "suggest").length;
    const n = drafts.length - suggestions;
    const { unreportedAutoChanges } = await import(dist("skill-ledger"));
    const auto = unreportedAutoChanges(root);
    const { curatorDue } = await import(dist("skill-curator"));
    if (curatorDue(root)) {
      const { spawn } = await import("node:child_process");
      const cli = new URL("../dist/cli/index.js", import.meta.url).pathname;
      spawn(process.execPath, [cli, "skill-loop", "curate", "--auto"], { cwd: root, env, detached: true, stdio: "ignore" }).unref();
    }
    const lines = [];
    if (auto.length) {
      const shown = auto.slice(-10).map((e) => `${e.action} ${e.skill} (ledger ${e.id})`);
      lines.push(`[skill loop] auto mode changed learned skills since you last looked: ${shown.join(", ")}${auto.length > 10 ? `, and ${auto.length - 10} earlier` : ""}. Undo one: \`semantic-memory skill-loop rollback <ledger id>\`.`);
    }
    if (n) lines.push(`[skill loop] ${n} skill draft${n > 1 ? "s" : ""} waiting for review (\`/skill-loop review\`).`);
    if (suggestions) lines.push(`[skill loop] ${suggestions} suggested change${suggestions > 1 ? "s" : ""} to hand-written skills waiting for you (\`/skill-loop review\`).`);
    if (lines.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } }) + "\n");
  } else if (input.hook_event_name === "PostToolUse" && input.tool_name === "Skill") {
    const skill = input.tool_input?.skill;
    if (typeof skill === "string" && skill) ev.appendEvidence(root, "usage", { session_id, skill, via: "tool" }, env);
  } else if (input.hook_event_name === "SessionEnd") {
    const q = await import(dist("skill-queue"));
    const job = q.sessionJob(root, input, env);
    if (!job) return;
    q.enqueue(job, env);
    const { spawnWorker } = await import(dist("skill-worker"));
    spawnWorker(root, env);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => debug(e.message));
}

/**
 * Task eval (v1.7): replay a task prompt with and without the skill, each in its own throwaway
 * `git worktree` of HEAD (the real working tree is never touched), then check the outcome with the skill's
 * `## Verify`: a command is run here, in the scratch copy; prose is graded — by Jev in jev mode, else by
 * the grader prompt through `claude -p`.
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runClaude } from "../claude-run.js";
import { featureOn } from "../features.js";
import { askJev, jevVerdict } from "../jev.js";
import { parseSkill } from "../skill-schema.js";
import { graderPrompt, parseGrade } from "./prompts/grader.js";

const execFileP = promisify(execFile);

export type Verify = { kind: "command"; command: string } | { kind: "prose"; text: string } | { kind: "none" };

/** The `## Verify` section as a command (fenced block, or a leading inline-backtick span) or as prose. */
export function parseVerify(body: string): Verify {
  const m = body.match(/^##\s+Verify\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  const text = m?.[1].trim() ?? "";
  if (!text) return { kind: "none" };
  const fenced = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fenced?.[1].trim()) return { kind: "command", command: fenced[1].trim() };
  const inline = text.replace(/^(?:[-*]|\d+\.)\s+/, "").match(/^`([^`\n]+)`/);
  return inline ? { kind: "command", command: inline[1].trim() } : { kind: "prose", text };
}

export interface TaskArm {
  passed: boolean;
  evidence: string;
  /** the run's final text */
  finalText: string;
  error?: string;
}

export interface TaskReport {
  skill: string;
  verify: Verify;
  with: TaskArm;
  without: TaskArm;
}

export interface TaskOptions {
  repoRoot: string;
  skillRaw: string;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  maxTurns?: number;
  timeoutMs?: number;
  verifyTimeoutMs?: number;
}

const OUTCOME_CAP = 2000;

async function runArm(o: TaskOptions, withSkill: boolean): Promise<TaskArm> {
  const env = o.env ?? process.env;
  const skill = parseSkill(o.skillRaw);
  const verify = parseVerify(skill.body);
  const holder = mkdtempSync(join(tmpdir(), "sm-skill-task-"));
  const dir = join(holder, "repo");
  const git = (...a: string[]) => execFileSync("git", ["-C", o.repoRoot, ...a], { stdio: "pipe" });
  try {
    git("worktree", "add", "--detach", dir, "HEAD");
    const skillDir = join(dir, ".claude", "skills", skill.name);
    rmSync(skillDir, { recursive: true, force: true }); // the baseline must not have it, the other arm gets this exact text
    if (withSkill) {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), o.skillRaw);
    }
    // dontAsk denies whatever is not allowed: edits, and only the commands the skill says it applies to
    const allowedTools = ["Edit", "Write", ...(skill.meta?.applies_to.commands ?? []).map((c) => `Bash(${c}:*)`)];
    const run = await runClaude({
      prompt: o.prompt,
      cwd: dir,
      tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
      allowedTools,
      maxTurns: o.maxTurns ?? 12,
      env,
      timeoutMs: o.timeoutMs,
    });
    const finalText = run.result.slice(0, OUTCOME_CAP);
    if (!run.ok) return { passed: false, evidence: "the run failed", finalText, error: run.error };
    if (verify.kind === "none") return { passed: false, evidence: "the skill has no ## Verify to check", finalText };
    if (verify.kind === "command") {
      try {
        await execFileP("bash", ["-c", verify.command], { cwd: dir, timeout: o.verifyTimeoutMs ?? 120_000, env });
        return { passed: true, evidence: `\`${verify.command}\` exited 0`, finalText };
      } catch (e) {
        return { passed: false, evidence: `\`${verify.command}\` failed: ${String((e as Error).message).slice(0, 200)}`, finalText };
      }
    }
    if (featureOn("jev", o.repoRoot, env)) {
      const a = await askJev(
        { cwd: o.repoRoot, caller: "semantic-memory-skill-loop", state: finalText, questions: [{ key: "verify", instructions: `Does this outcome satisfy: ${verify.text}?` }] },
        { env },
      );
      const p = a.scores.verify;
      return { passed: jevVerdict(p) === true, evidence: a.error ? `jev: ${a.error}` : `jev p=${p}`, finalText };
    }
    const g = await runClaude({ prompt: graderPrompt(verify.text, finalText), cwd: dir, tools: [], maxTurns: 1, env, timeoutMs: o.timeoutMs });
    return { ...(g.ok ? parseGrade(g.result) : { passed: false, evidence: `grader failed: ${g.error}` }), finalText };
  } catch (e) {
    return { passed: false, evidence: "could not set up the scratch copy", finalText: "", error: (e as Error).message };
  } finally {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {}
    rmSync(holder, { recursive: true, force: true });
    try {
      git("worktree", "prune");
    } catch {}
  }
}

export async function runTaskEval(o: TaskOptions): Promise<TaskReport> {
  const skill = parseSkill(o.skillRaw);
  const [w, wo] = await Promise.all([runArm(o, true), runArm(o, false)]);
  return { skill: skill.name, verify: parseVerify(skill.body), with: w, without: wo };
}

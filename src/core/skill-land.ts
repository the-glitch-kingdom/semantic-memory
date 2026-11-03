/**
 * Landing drafts (v1.7): `skill-loop review`. Nothing a reviewer drafts reaches .claude/skills/ until a
 * person approves it here; every landing, patch, promotion and rejection is a ledger entry (skill-ledger.ts).
 *
 *  - new draft    → <repo>/.claude/skills/<name>/ (project) or <repo>/<dir>/.claude/skills/<name>/ (directory)
 *  - patch draft  → replaces its target, only if the target is byte-for-byte what the draft was made from
 *  - promotion    → ~/.claude/skills/<name>/ (global), replacing the landed project copies in the other repos
 *
 * Evals run here, on request: trigger evals freely (no tools that touch anything), task evals only with
 * --task, since they run the draft's own Verify command.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { applyChange, archiveDir, type LedgerEntry } from "./skill-ledger.js";
import { listDrafts, reviewSession, transcriptTimeline, type DraftRecord, type ReviewOptions } from "./skill-review.js";
import { findSkills, lintSkill, parseSkill, renderSkill, type SkillLoopMeta } from "./skill-schema.js";
import { indexSkill } from "./skill-scope.js";
import { log, queueDir, type ReviewJob } from "./skill-queue.js";
import type { ReviewOutcome } from "./skill-worker.js";
import { autoOn } from "./features.js";
import { buildEvalSet, type CandidatePrompt } from "./skill-eval/sets.js";
import { runTrigger } from "./skill-eval/trigger.js";
import { runTaskEval, parseVerify } from "./skill-eval/task.js";
import { gateSkill } from "./skill-gate.js";

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const home = (env = process.env) => env.HOME || homedir();

export function destinationFor(repo: string, r: DraftRecord, opts: { global?: boolean; env?: NodeJS.ProcessEnv } = {}): string {
  if (opts.global) return join(home(opts.env), ".claude", "skills", r.name, "SKILL.md");
  if ((r.kind === "patch" || (r.kind === "suggest" && r.action === "patch")) && r.target) return r.target;
  if ((r.kind === "archive" || r.kind === "suggest") && r.target) return join(archiveDir(repo), r.name, "SKILL.md");
  return r.scope === "directory" && r.directory ? join(repo, r.directory, ".claude", "skills", r.name, "SKILL.md") : join(repo, ".claude", "skills", r.name, "SKILL.md");
}

function getDraft(repo: string, id: string) {
  const d = listDrafts(repo).find((x) => x.record.id === id);
  if (!d) throw new Error(`no draft ${id} (skill-loop review lists them)`);
  return { ...d, text: readFileSync(join(d.dir, "SKILL.md"), "utf8") };
}

function diff(a: string, b: string): string {
  const r = spawnSync("git", ["diff", "--no-index", "--no-color", "--", a, b], { encoding: "utf8" });
  return r.stdout || "";
}

export interface DraftView {
  id: string;
  kind: DraftRecord["kind"];
  name: string;
  scope: string;
  destination: string;
  scope_why?: string;
  provenance: SkillLoopMeta["provenance"] | null;
  warnings: string[];
  evals?: Record<string, unknown>;
  promotion?: DraftRecord["promotion"];
  global_candidate?: boolean;
  /** the Verify command a task eval would run, shown before anyone runs it */
  verify: ReturnType<typeof parseVerify>;
  text: string;
  diff?: string;
  /** v1.8: archive / suggest */
  action?: DraftRecord["action"];
  why?: string;
  real_path?: string;
}

export function describeDrafts(repo: string, env = process.env): DraftView[] {
  return listDrafts(repo).map(({ dir, record }) => {
    const file = join(dir, "SKILL.md");
    const text = readFileSync(file, "utf8");
    const s = parseSkill(text);
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      scope: record.scope,
      destination: destinationFor(repo, record, { env }),
      scope_why: record.scope_why,
      provenance: s.meta?.provenance ?? null,
      warnings: record.warnings,
      evals: record.evals,
      promotion: record.promotion,
      global_candidate: record.global_candidate,
      verify: parseVerify(s.body),
      text,
      ...(record.action ? { action: record.action } : {}),
      ...(record.why ? { why: record.why } : {}),
      ...(record.real_path ? { real_path: record.real_path } : {}),
      ...((record.kind === "patch" || (record.kind === "suggest" && record.action === "patch")) && record.target && existsSync(record.target) ? { diff: diff(record.target, file) } : {}),
    };
  });
}

/** The draft's text as it will land: status active, and for a promotion global with nothing repo-specific. */
function landedText(text: string, global: boolean): string {
  const s = parseSkill(text);
  const meta: SkillLoopMeta = {
    ...s.meta!,
    status: "active",
    ...(global ? { scope: "global" as const, applies_to: { paths: [], commands: s.meta!.applies_to.commands }, cites: [] } : {}),
  };
  return renderSkill({ name: s.name, description: s.description, meta, body: s.body });
}

/**
 * Archive a skill, or apply a suggestion to a hand-written one (v1.8). Both land only onto the exact bytes they
 * were drafted from. A suggestion is never applied by the loop, and not through a link: the user applies it at
 * the real file (often a package, where an update would undo it).
 */
function approveRetireOrSuggestion(repo: string, d: ReturnType<typeof getDraft>, actor: LedgerEntry["actor"], env: NodeJS.ProcessEnv): LedgerEntry {
  const r = d.record;
  if (r.kind === "suggest" && actor !== "user") throw new Error(`${r.id} is a suggestion for a hand-written skill: only a person applies it`);
  if (r.kind === "suggest" && r.real_path) throw new Error(`${r.target} is a link to ${r.real_path}: apply this suggestion there by hand (skill-loop review shows the diff), then reject it`);
  const target = r.target!;
  if (!existsSync(target) || sha256(readFileSync(target)) !== r.base_sha256) throw new Error(`${target} changed since this draft was made: reject it and let the next review redo it`);
  const why = `${r.kind === "suggest" ? `suggestion (${r.action})` : "archive"} from ${r.session_id}${r.why ? `: ${r.why}` : ""}`;
  let entry: LedgerEntry;
  if (r.kind === "suggest" && r.action === "patch") {
    entry = applyChange(repo, { action: "patch", actor, skill: r.name, why }, [{ path: target, content: d.text }]);
  } else {
    const raw = readFileSync(target, "utf8");
    const s = parseSkill(raw);
    // a learned skill is marked archived; a hand-written one is moved as it is
    const archived = s.meta ? renderSkill({ name: s.name, description: s.description, meta: { ...s.meta, status: "archived" }, body: s.body }) : raw;
    entry = applyChange(repo, { action: "archive", actor, skill: r.name, why }, [
      { path: join(archiveDir(repo), r.name, "SKILL.md"), content: archived },
      { path: target, content: null },
    ]);
    indexSkill({ repo, name: r.name, path: target, status: "archived" }, env);
  }
  rmSync(d.dir, { recursive: true, force: true });
  return entry;
}

export function approveDraft(repo: string, id: string, opts: { promote?: boolean; override?: string; env?: NodeJS.ProcessEnv; actor?: LedgerEntry["actor"] } = {}): LedgerEntry {
  const env = opts.env ?? process.env;
  const actor = opts.actor ?? "user";
  const d = getDraft(repo, id);
  const r = d.record;
  if (r.kind === "archive" || r.kind === "suggest") return approveRetireOrSuggestion(repo, d, actor, env);
  // evals are optional, but once they ran a failing draft stays a draft unless a person overrides (ledgered)
  const gate = (r.evals as { gate?: { verdict: string; reasons: string[] } } | undefined)?.gate;
  if (gate && gate.verdict !== "adopt" && !opts.override) {
    throw new Error(`the eval gate said ${gate.verdict}: ${gate.reasons.join("; ")} — re-run --eval, or approve with --override "<why>"`);
  }
  if (opts.promote && !r.promotion?.length) throw new Error(`${id} has no promotion: a skill goes global only when another repo has the same lesson`);
  const dest = destinationFor(repo, r, { global: opts.promote, env });
  const text = landedText(d.text, !!opts.promote);
  const others = findSkills(repo, { home: home(env) }).filter((s) => s.path !== dest);
  const errors = lintSkill(dest, text, { projectRoot: repo, others }, r.name).filter((f) => f.severity === "error");
  if (errors.length) throw new Error(`does not pass lint: ${errors.map((f) => `${f.rule}: ${f.message}`).join("; ")}`);
  const replaced = r.kind === "merge" ? (r.supersedes ?? []) : [];
  if (r.kind === "patch") {
    if (!existsSync(dest) || sha256(readFileSync(dest)) !== r.base_sha256) throw new Error(`${dest} changed since this patch was drafted: reject it and let the next review redo it`);
  } else if (existsSync(dest) && !replaced.includes(dest)) {
    throw new Error(`${dest} already exists`);
  }
  for (const p of replaced) if (!existsSync(p)) throw new Error(`${p}, which this merge replaces, is gone: reject the merge`);
  const why = `${r.kind}${opts.promote ? " promoted to global" : ""} from session ${r.session_id}${gate && gate.verdict !== "adopt" ? `; eval gate ${gate.verdict}, overridden: ${opts.override}` : ""}`;
  // a merge lands the new skill and archives the ones it supersedes, in one ledger entry (one rollback)
  const archived = replaced.filter((p) => p !== dest).flatMap((p) => [
    { path: join(repo, ".claude", ".semantic-memory", "skills-archive", basename(dirname(p)), "SKILL.md"), content: readFileSync(p) as Buffer | string | null },
    { path: p, content: null },
  ]);
  const entry = applyChange(repo, { action: opts.promote ? "promote" : r.kind === "patch" ? "patch" : r.kind === "merge" ? "merge" : "land", actor, skill: r.name, why }, [{ path: dest, content: text }, ...archived]);
  for (const p of replaced) if (p !== dest) indexSkill({ repo, name: basename(dirname(p)), path: p, status: "archived" }, env);
  if (opts.promote) {
    // the project copies the global skill replaces: only landed, learned ones, each ledgered in its own repo
    for (const p of r.promotion!) {
      if (!existsSync(p.path) || !p.path.includes(`${join(".claude", "skills")}`) || !/^skill_loop:/m.test(readFileSync(p.path, "utf8"))) continue;
      applyChange(p.repo, { action: "archive", actor: "user", skill: r.name, why: `replaced by the global skill ${dest}` }, [
        { path: join(p.repo, ".claude", ".semantic-memory", "skills-archive", r.name, "SKILL.md"), content: readFileSync(p.path) },
        { path: p.path, content: null },
      ]);
      indexSkill({ repo: p.repo, name: r.name, path: p.path, status: "archived" }, env);
    }
  }
  indexSkill({ repo: opts.promote ? "global" : repo, name: r.name, path: dest, status: "active" }, env);
  rmSync(d.dir, { recursive: true, force: true });
  return entry;
}

export function rejectDraft(repo: string, id: string, why = "rejected in review"): LedgerEntry {
  const d = getDraft(repo, id);
  const entry = applyChange(repo, { action: "reject", actor: "user", skill: d.record.name, why: `${why} (draft ${id}, session ${d.record.session_id})` }, []);
  rmSync(d.dir, { recursive: true, force: true });
  return entry;
}

/** User prompts from this repo's reviewed sessions: the material trigger evals are built from. */
export function reviewedPrompts(repo: string, env = process.env): CandidatePrompt[] {
  const dir = join(queueDir(env), "done");
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const out: CandidatePrompt[] = [];
  for (const f of files) {
    try {
      const job = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (job.repo !== repo) continue;
      for (const line of transcriptTimeline(job.transcript_path, 10_000)) {
        if (line.startsWith("USER: ")) out.push({ session: job.session_id, text: line.slice(6) });
      }
    } catch {}
  }
  return out;
}

/** Run the evals on a draft and store the scores and the gate's verdict in its record. */
export async function evalDraft(repo: string, id: string, opts: { task?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;
  const d = getDraft(repo, id);
  const skill = parseSkill(d.text);
  const prompts = reviewedPrompts(repo, env);
  const set = buildEvalSet(skill, prompts);
  const trigger = await runTrigger(set, { repoRoot: repo, skillRaw: d.text, env });
  let taskWith: number | null = null, taskWithout: number | null = null, task: unknown;
  if (opts.task) {
    const own = prompts.find((p) => skill.meta?.provenance.sessions.includes(p.session));
    if (own) {
      const t = await runTaskEval({ repoRoot: repo, skillRaw: d.text, prompt: own.text, env });
      taskWith = t.with.passed ? 1 : 0;
      taskWithout = t.without.passed ? 1 : 0;
      task = { with: t.with.evidence, without: t.without.evidence };
    }
  }
  const gate = gateSkill({ positiveRate: trigger.heldout.positiveRate, falseTriggerRate: trigger.heldout.falseTriggerRate, taskWith, taskWithout });
  const evals = { at: new Date().toISOString(), prompts: set.length, runs: trigger.runs, heldout: trigger.heldout, train: trigger.train, task, gate };
  writeFileSync(join(d.dir, "draft.json"), JSON.stringify({ ...d.record, evals }, null, 1));
  return evals;
}

/**
 * The worker's review (v1.8): review the session, then, in auto mode, apply what the reviewer drafted for learned
 * skills (new, patch, archive) as actor `reviewer`, each one ledgered so `rollback` undoes it. Suggestions for
 * hand-written skills, and any draft that fails to land (lint, a changed target, an existing folder), stay drafts.
 */
export async function reviewAndApply(job: ReviewJob, opts: ReviewOptions = {}): Promise<ReviewOutcome> {
  const env = opts.env ?? process.env;
  const out = await reviewSession(job, opts);
  if (!autoOn(job.repo, env) || !out.drafts.length) return out;
  const applied: string[] = [];
  const kept: string[] = [];
  for (const id of out.drafts) {
    const d = listDrafts(job.repo).find((x) => x.record.id === id);
    if (!d || d.record.kind === "suggest") {
      kept.push(id);
      continue;
    }
    try {
      const e = approveDraft(job.repo, id, { actor: "reviewer", env });
      applied.push(`${e.action} ${e.skill} (${e.id})`);
    } catch (err) {
      kept.push(id);
      log(job.repo, `auto: ${id} left for review — ${(err as Error).message}`);
    }
  }
  return { ...out, drafts: kept, applied };
}

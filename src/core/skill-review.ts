/**
 * The skill loop's reviewer (v1.7): one finished session in, zero to two skill drafts out.
 *
 *  1. A brief: the session's prompts, tool calls and errors (from the transcript, read fail-soft: its format
 *     is internal to Claude Code), plus the evidence logs, the skills this repo loads and its KB fact ids.
 *     Redacted (broad) and capped before the model sees it.
 *  2. A fenced `claude -p` (Read / Grep / Glob on the repo only; see claude-run.ts) answers JSON.
 *  3. Each draft is rendered, redacted, linted (skill-schema.ts) and written to
 *     .claude/.semantic-memory/skill-drafts/<id>/ — or rejected with its reasons. Nothing is written anywhere
 *     else; landing a draft is a person's call (`skill-loop review`).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { redact } from "./redact.js";
import { readEvidence, stateDir } from "./skill-evidence.js";
import { factIds, findSkills, lintSkill, renderSkill, type SkillFile, type SkillLoopMeta, type SkillScope } from "./skill-schema.js";
import { runClaude } from "./claude-run.js";
import { REVIEW_PROMPT } from "./skill-review-prompt.js";
import type { ReviewJob } from "./skill-queue.js";
import type { ReviewOutcome } from "./skill-worker.js";

export const draftsDir = (repo: string) => join(stateDir(repo), "skill-drafts");
const BRIEF_MAX = 40_000;
const TIMELINE_MAX = 120;

export interface DraftRecord {
  id: string;
  kind: "new" | "patch";
  name: string;
  scope: SkillScope;
  /** patch: the SKILL.md it replaces, and that file's sha256 when the draft was made */
  target?: string;
  base_sha256?: string;
  session_id: string;
  created: string;
  warnings: string[];
  /** filled by skill evals (Phase 14) when they run at approval time */
  evals?: Record<string, unknown>;
}

// --- the brief ---

/** The session's timeline from its transcript: prompts, tool calls, and the errors they returned. Fail-soft. */
export function transcriptTimeline(path: string | null, max = TIMELINE_MAX): string[] {
  if (!path) return [];
  let raw = "";
  try {
    if (statSync(path).size > 200 * 1024 * 1024) return ["(transcript too large to read)"];
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  const calls = new Map<string, string>();
  for (const line of raw.split("\n")) {
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e?.message?.content;
    if (e?.type === "user" && typeof content === "string" && !e.isMeta) {
      // wrappers (slash-command echoes, task notifications, local command output) are not the user talking
      if (!content.trimStart().startsWith("<")) out.push(`USER: ${content.slice(0, 600)}`);
    } else if (e?.type === "assistant" && Array.isArray(content)) {
      for (const c of content) {
        if (c?.type !== "tool_use") continue;
        const input = c.input ?? {};
        const what = typeof input.command === "string" ? input.command : typeof input.file_path === "string" ? input.file_path : typeof input.skill === "string" ? input.skill : JSON.stringify(input);
        calls.set(c.id, `${c.name}: ${String(what).slice(0, 300)}`);
      }
    } else if (e?.type === "user" && Array.isArray(content)) {
      for (const c of content) {
        if (c?.type !== "tool_result") continue;
        const call = calls.get(c.tool_use_id) ?? "tool";
        const text = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x: any) => x?.text ?? "").join(" ") : "";
        out.push(c.is_error ? `TOOL ${call}\n  → ERROR (${c.tool_use_id}): ${text.slice(0, 500)}` : `TOOL ${call} → ok`);
      }
    }
  }
  // keep the end of long sessions (where the fix landed) and every error
  if (out.length <= max) return out;
  const errors = out.filter((l) => l.includes("→ ERROR")).slice(-Math.floor(max / 2));
  const tail = out.slice(-(max - errors.length)).filter((l) => !errors.includes(l));
  return [`(${out.length - errors.length - tail.length} earlier entries omitted)`, ...errors, ...tail];
}

function topLevel(repo: string): string[] {
  try {
    return readdirSync(repo).filter((f) => !f.startsWith(".") || f === ".claude" || f === ".documentation").slice(0, 60);
  } catch {
    return [];
  }
}

export function buildBrief(job: ReviewJob, skills: SkillFile[] = findSkills(job.repo)): string {
  const repo = job.repo;
  const failures = readEvidence(repo, "failures").filter((f) => f.session_id === job.session_id);
  const corrections = readEvidence(repo, "corrections").filter((c) => c.session_id === job.session_id);
  const used = new Set(job.evidence.skills_used);
  const lines = [
    `# Session ${job.session_id}`,
    `Repository: ${basename(repo)} — top level: ${topLevel(repo).join(", ")}`,
    `Why reviewed: ${job.reason}`,
    "",
    "## Failures (from the evidence log)",
    ...(failures.length ? failures.map((f) => `- id ${f.id}: \`${f.command}\`\n  error: ${String(f.error).slice(0, 500)}`) : ["(none)"]),
    "",
    "## Corrections the user gave",
    ...(corrections.length ? corrections.map((c, i) => `- correction ${i + 1} (${c.cue}): ${c.excerpt}`) : ["(none)"]),
    "",
    "## Skills this repository loads",
    ...(skills.length
      ? skills.map((s) => `- ${s.skill.name || basename(s.dir)} (${s.scope}; learned: ${s.learned}${s.skill.meta?.pinned ? "; pinned" : ""}${used.has(s.skill.name) ? "; USED this session" : ""}): ${s.skill.description.slice(0, 200)}`)
      : ["(none)"]),
    ...skills
      .filter((s) => s.learned && used.has(s.skill.name))
      .flatMap((s) => ["", `### Current text of the learned skill ${s.skill.name} (used this session)`, s.skill.body.slice(0, 4000)]),
    "",
    "## Knowledge-base fact ids (for cites)",
    [...factIds(repo)].slice(0, 200).join(", ") || "(none)",
    "",
    "## Timeline (prompts, tool calls, errors)",
    ...transcriptTimeline(job.transcript_path),
  ];
  let brief = redact(lines.join("\n"), "broad").text;
  if (brief.length > BRIEF_MAX) brief = brief.slice(0, BRIEF_MAX) + "\n(brief cut at its size cap)";
  return brief;
}

// --- the answer ---

export interface ReviewerDraft {
  kind: "new" | "patch";
  target?: string;
  name: string;
  description: string;
  scope: string;
  applies_to?: { paths?: string[]; commands?: string[] };
  triggers?: string[];
  provenance?: { sessions?: string[]; failures?: string[]; corrections?: string[] };
  cites?: string[];
  body: string;
}

/** The JSON object in the reviewer's answer (bare, or inside a ```json fence). */
export function parseReviewerJson(text: string): { drafts: ReviewerDraft[]; none_reason?: string } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c.trim());
      if (v && Array.isArray(v.drafts)) return v;
    } catch {}
  }
  return null;
}

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Turn one reviewer draft into a draft folder, or say why not. `resolveScope` decides the final scope
 * (Phase 15: deterministic rules, then Jev); without it the reviewer's project / directory stands.
 */
export async function materializeDraft(
  repo: string,
  job: ReviewJob,
  d: ReviewerDraft,
  skills: SkillFile[],
  resolveScope: (d: ReviewerDraft) => Promise<SkillScope> = async (x) => (x.scope === "directory" ? "directory" : "project"),
): Promise<{ id?: string; rejected?: string }> {
  if (!d || typeof d.name !== "string" || typeof d.body !== "string" || typeof d.description !== "string") return { rejected: "malformed draft" };
  let target: SkillFile | undefined;
  if (d.kind === "patch") {
    target = skills.find((s) => s.skill.name === d.target);
    if (!target) return { rejected: `patch target "${d.target}" not found` };
    if (!target.learned) return { rejected: `"${d.target}" was not written by the skill loop: never patched` };
    if (target.skill.meta?.pinned) return { rejected: `"${d.target}" is pinned` };
  }
  const prov = {
    sessions: [...new Set([job.session_id, ...strs(d.provenance?.sessions)])],
    failures: strs(d.provenance?.failures),
    corrections: strs(d.provenance?.corrections),
  };
  if (prov.failures.length + prov.corrections.length === 0 && job.evidence.failures.length + job.evidence.corrections === 0) {
    return { rejected: "no failure or correction behind it" };
  }
  const scope = await resolveScope(d);
  const name = d.kind === "patch" ? target!.skill.name : d.name;
  const meta: SkillLoopMeta = {
    schema: 1,
    scope,
    status: "draft",
    pinned: false,
    triggers: strs(d.triggers),
    applies_to: { paths: strs(d.applies_to?.paths), commands: strs(d.applies_to?.commands) },
    provenance: prov,
    cites: strs(d.cites),
    supersedes: target?.skill.meta?.supersedes ?? [],
  };
  // precise: a skill is prose and code, broad would mangle ordinary identifiers
  const text = redact(renderSkill({ name, description: d.description, meta, body: d.body }), "precise").text;
  const findings = lintSkill(join(draftsDir(repo), name, "SKILL.md"), text, { projectRoot: repo, others: skills.filter((s) => s.path !== target?.path) }, name);
  const errors = findings.filter((f) => f.severity === "error");
  if (errors.length) return { rejected: `lint: ${errors.map((f) => `${f.rule}: ${f.message}`).join("; ")}` };
  const id = `${name}-${sha256(text).slice(0, 8)}`;
  const dir = join(draftsDir(repo), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
  const record: DraftRecord = {
    id,
    kind: d.kind === "patch" ? "patch" : "new",
    name,
    scope,
    ...(target ? { target: target.path, base_sha256: sha256(readFileSync(target.path, "utf8")) } : {}),
    session_id: job.session_id,
    created: new Date().toISOString(),
    warnings: findings.filter((f) => f.severity === "warn").map((f) => `${f.rule}: ${f.message}`),
  };
  writeFileSync(join(dir, "draft.json"), JSON.stringify(record, null, 1));
  return { id };
}

export function listDrafts(repo: string): { dir: string; record: DraftRecord }[] {
  let ids: string[] = [];
  try {
    ids = readdirSync(draftsDir(repo));
  } catch {
    return [];
  }
  const out: { dir: string; record: DraftRecord }[] = [];
  for (const id of ids) {
    const dir = join(draftsDir(repo), id);
    try {
      if (existsSync(join(dir, "SKILL.md"))) out.push({ dir, record: JSON.parse(readFileSync(join(dir, "draft.json"), "utf8")) });
    } catch {}
  }
  return out.sort((a, b) => a.record.created.localeCompare(b.record.created));
}

export interface ReviewOptions {
  env?: NodeJS.ProcessEnv;
  resolveScope?: (d: ReviewerDraft, job: ReviewJob) => Promise<SkillScope>;
  maxTurns?: number;
}

/** Review one queued session (the worker's review function). */
export async function reviewSession(job: ReviewJob, opts: ReviewOptions = {}): Promise<ReviewOutcome> {
  const skills = findSkills(job.repo);
  const brief = buildBrief(job, skills);
  const run = await runClaude({
    prompt: `${REVIEW_PROMPT}\n\n---\n\n${brief}`,
    cwd: job.repo,
    tools: ["Read", "Grep", "Glob"],
    maxTurns: opts.maxTurns ?? 8,
    output: "json",
    timeoutMs: 10 * 60_000,
    env: opts.env,
  });
  if (!run.ok && !run.result) throw new Error(run.error ?? "reviewer run failed");
  const answer = parseReviewerJson(run.result);
  if (!answer) return { drafts: [], rejected: [{ reason: "reviewer answer was not JSON" }], costUsd: run.costUsd };
  const drafts: string[] = [];
  const rejected: { reason: string }[] = [];
  for (const d of answer.drafts.slice(0, 2)) {
    const r = await materializeDraft(job.repo, job, d, skills, opts.resolveScope ? (x) => opts.resolveScope!(x, job) : undefined);
    if (r.id) drafts.push(r.id);
    else rejected.push({ reason: `${d?.name ?? "?"}: ${r.rejected}` });
  }
  return { drafts, rejected, costUsd: run.costUsd, note: answer.drafts.length ? undefined : answer.none_reason?.slice(0, 200) };
}

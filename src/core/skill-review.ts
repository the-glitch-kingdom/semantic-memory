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
import { decideScope, indexSkill, promotionPeers, type ScopeDecision } from "./skill-scope.js";

export const draftsDir = (repo: string) => join(stateDir(repo), "skill-drafts");
const BRIEF_MAX = 40_000;
const TIMELINE_MAX = 120;

export interface DraftRecord {
  id: string;
  kind: "new" | "patch" | "merge";
  name: string;
  scope: SkillScope;
  /** patch: the SKILL.md it replaces, and that file's sha256 when the draft was made */
  target?: string;
  base_sha256?: string;
  session_id: string;
  created: string;
  warnings: string[];
  /** directory scope: where it lands (repo-relative subdirectory) */
  directory?: string;
  scope_why?: string;
  /** Jev thinks it holds in any repo */
  global_candidate?: boolean;
  /** other repos with the same lesson: review offers one global skill replacing the copies */
  promotion?: { repo: string; path: string }[];
  /** merge: the SKILL.md files the merged skill replaces (archived when it lands) */
  supersedes?: string[];
  /** filled by skill evals (Phase 14) when they run at approval time */
  evals?: Record<string, unknown>;
}

// --- the brief ---

/**
 * The session's timeline from its transcript: prompts, tool calls, and the errors they returned. Fail-soft.
 * `since`: only entries after it (a follow-up review of a resumed session).
 */
export function transcriptTimeline(path: string | null, max = TIMELINE_MAX, since?: string): string[] {
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
    // calls are remembered from the whole transcript so a result after `since` still names its call
    const shown = !since || String(e?.timestamp ?? "") > since;
    if (!shown && e?.type !== "assistant") continue;
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
  const mine = (r: Record<string, any>) => r.session_id === job.session_id && (!job.since || String(r.ts ?? "") > job.since);
  const failures = readEvidence(repo, "failures").filter(mine);
  const corrections = readEvidence(repo, "corrections").filter(mine);
  const used = new Set(job.evidence.skills_used);
  // free text is redacted (broad); the ids the reviewer must cite back (session, failure ids) are not, or broad
  // redaction would mask them too. The evidence logs were redacted when written.
  const r = (t: string) => redact(t, "broad").text;
  const lines = [
    `# Session ${job.session_id}`,
    `Repository: ${basename(repo)} — top level: ${topLevel(repo).join(", ")}`,
    `Why reviewed: ${job.reason}`,
    ...(job.since ? [`Follow-up review: this session was reviewed at ${job.since} and then resumed. Below is only what happened after that; judge the new evidence.`] : []),
    "",
    "## Failures (from the evidence log)",
    ...(failures.length ? failures.map((f) => `- id ${f.id}: \`${r(String(f.command))}\`\n  error: ${r(String(f.error).slice(0, 500))}`) : ["(none)"]),
    "",
    "## Corrections the user gave",
    ...(corrections.length ? corrections.map((c, i) => `- correction ${i + 1} (${c.cue}): ${r(String(c.excerpt))}`) : ["(none)"]),
    "",
    "## Skills this repository loads",
    ...(skills.length
      ? skills.map((s) => `- ${s.skill.name || basename(s.dir)} (${s.scope}; learned: ${s.learned}${s.skill.meta?.pinned ? "; pinned" : ""}${used.has(s.skill.name) ? "; USED this session" : ""}): ${r(s.skill.description.slice(0, 200))}`)
      : ["(none)"]),
    ...skills
      .filter((s) => s.learned && used.has(s.skill.name))
      .flatMap((s) => ["", `### Current text of the learned skill ${s.skill.name} (used this session)`, r(s.skill.body.slice(0, 4000))]),
    "",
    "## Knowledge-base fact ids (for cites)",
    [...factIds(repo)].slice(0, 200).join(", ") || "(none)",
    "",
    "## Timeline (prompts, tool calls, errors)",
    ...transcriptTimeline(job.transcript_path, TIMELINE_MAX, job.since).map(r),
  ];
  let brief = lines.join("\n");
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

// a placeholder the model copied from redacted text is not evidence
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !x.includes("[REDACTED]")) : []);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type ScopeResolver = (d: ReviewerDraft) => Promise<ScopeDecision>;

/**
 * Turn one reviewer draft into a draft folder, or say why not. `resolveScope` decides the final scope
 * (skill-scope.ts: deterministic rules, then Jev); the reviewer's own choice is never trusted for it.
 */
export async function materializeDraft(
  repo: string,
  job: ReviewJob,
  d: ReviewerDraft,
  skills: SkillFile[],
  resolveScope: ScopeResolver = (x) => decideScope(repo, x),
  env = process.env,
  merge?: { supersedes: string[] },
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
  // a patch keeps its skill's scope; a new skill's comes from the resolver
  const decision: ScopeDecision = target
    ? { scope: target.scope === "directory" ? "directory" : "project", globalCandidate: false, why: "patch: the skill's own scope" }
    : await resolveScope(d);
  const scope: SkillScope = target?.scope ?? decision.scope;
  const paths = strs(d.applies_to?.paths);
  if (decision.directory && !paths.includes(decision.directory)) paths.unshift(decision.directory);
  const name = d.kind === "patch" ? target!.skill.name : d.name;
  const meta: SkillLoopMeta = {
    schema: 1,
    scope,
    status: "draft",
    pinned: false,
    triggers: strs(d.triggers),
    applies_to: { paths, commands: strs(d.applies_to?.commands) },
    provenance: prov,
    cites: strs(d.cites),
    supersedes: merge ? merge.supersedes.map((p) => basename(join(p, ".."))) : (target?.skill.meta?.supersedes ?? []),
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
    kind: merge ? "merge" : d.kind === "patch" ? "patch" : "new",
    name,
    scope,
    ...(target ? { target: target.path, base_sha256: sha256(readFileSync(target.path, "utf8")) } : {}),
    session_id: job.session_id,
    created: new Date().toISOString(),
    warnings: findings.filter((f) => f.severity === "warn").map((f) => `${f.rule}: ${f.message}`),
    ...(decision.directory ? { directory: decision.directory } : {}),
    scope_why: decision.why,
    ...(decision.globalCandidate ? { global_candidate: true } : {}),
    ...(merge ? { supersedes: merge.supersedes } : {}),
  };
  if (!target && !merge) {
    const peers = promotionPeers(repo, name, env);
    if (peers.length) record.promotion = peers.map((p) => ({ repo: p.repo, path: p.path }));
    indexSkill({ repo, name, path: join(dir, "SKILL.md"), status: "draft", ...(decision.globalCandidate ? { global_candidate: true } : {}) }, env);
  }
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
  resolveScope?: ScopeResolver;
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
    const env = opts.env ?? process.env;
    const r = await materializeDraft(job.repo, job, d, skills, opts.resolveScope ?? ((x) => decideScope(job.repo, x, env)), env);
    if (r.id) drafts.push(r.id);
    else rejected.push({ reason: `${d?.name ?? "?"}: ${r.rejected}` });
  }
  return { drafts, rejected, costUsd: run.costUsd, note: answer.drafts.length ? undefined : answer.none_reason?.slice(0, 200) };
}

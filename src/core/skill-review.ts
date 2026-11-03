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
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { findSecrets, redact } from "./redact.js";
import { readEvidence, stateDir } from "./skill-evidence.js";
import { deadRefs, duplicateOf, factIds, findSkills, lintSkill, parseSkill, refRoots, renderSkill, skillWords, type SkillFile, type SkillLoopMeta, type SkillScope } from "./skill-schema.js";
import { runClaude } from "./claude-run.js";
import { REVIEW_PROMPT } from "./skill-review-prompt.js";
import { curatorState } from "./skill-curator.js";
import type { ReviewJob } from "./skill-queue.js";
import type { ReviewOutcome } from "./skill-worker.js";
import { decideScope, indexSkill, promotionPeers, type ScopeDecision } from "./skill-scope.js";

export const draftsDir = (repo: string) => join(stateDir(repo), "skill-drafts");
const BRIEF_MAX = 40_000;
/** drafts one review may produce (v1.7: 2; v1.8 adds archive and suggestions) */
export const MAX_DRAFTS = 3;
const TIMELINE_MAX = 120;

export interface DraftRecord {
  id: string;
  /** v1.8: archive = retire a learned skill; suggest = a change to a hand-written skill, never applied by the loop */
  kind: "new" | "patch" | "merge" | "archive" | "suggest";
  name: string;
  /** suggest: what applying it does to the hand-written skill */
  action?: "patch" | "archive";
  /** archive / suggest-archive: the reviewer's one-line evidence */
  why?: string;
  /** suggest: the real file when the skill folder is a link (e.g. into node_modules) */
  real_path?: string;
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

const RELATED_MAX = 4;
const RELATED_MIN = 0.4;
const SKILL_TEXT_MAX = 3000;
// words every skill description has: they say nothing about which procedure it is
const STOP = new Set(["use", "when", "the", "and", "for", "with", "this", "that", "from", "your", "you", "not", "into", "its", "are", "how", "what", "after", "before"]);
const short = (name: string) => name.split(":").pop()!;

/** Skills to show the reviewer in full: those used this session first, then those whose words the session shares most. */
export function relatedSkills(skills: SkillFile[], used: Set<string>, sessionText: string, max = RELATED_MAX): SkillFile[] {
  const seen = new Set(sessionText.toLowerCase().split(/[^a-z0-9]+/));
  const score = (s: SkillFile) => {
    const w = [...skillWords(s.skill)].filter((x) => !STOP.has(x));
    return w.length ? w.filter((x) => seen.has(x)).length / w.length : 0;
  };
  const usedOnes = skills.filter((s) => used.has(s.skill.name));
  const rest = skills
    .filter((s) => !used.has(s.skill.name))
    .map((s) => ({ s, v: score(s) }))
    .filter((x) => x.v >= RELATED_MIN)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.s);
  return [...usedOnes, ...rest].slice(0, max);
}

export function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** One skill in full for the reviewer: what it is, whether it may change, its dead references and failed Verify. */
function skillBlock(repo: string, s: SkillFile, used: Set<string>, r: (t: string) => string, verifyFailed?: string): string[] {
  const name = s.skill.name || basename(s.dir);
  const real = realPath(s.path);
  const dead = deadRefs(s.skill, refRoots(repo, s));
  const kind = s.skill.meta?.pinned ? "pinned: never change it" : s.learned ? "learned" : "hand-written: a patch or archive of it becomes a suggestion for the user";
  return [
    "",
    `### ${name} (${s.scope}; ${kind}${used.has(name) ? "; USED this session" : ""})`,
    `description: ${r(s.skill.description.slice(0, 300))}`,
    ...(real !== s.path ? [`file: a link to ${real}`] : []),
    `dead references (paths it names that do not exist here): ${dead.join(", ") || "none"}`,
    ...(verifyFailed ? [`its ## Verify command failed: ${r(verifyFailed.slice(0, 300))}`] : []),
    "```markdown",
    r(s.skill.body.slice(0, SKILL_TEXT_MAX)) + (s.skill.body.length > SKILL_TEXT_MAX ? "\n(cut)" : ""),
    "```",
  ];
}

export function buildBrief(job: ReviewJob, skills: SkillFile[] = findSkills(job.repo)): string {
  const repo = job.repo;
  // free text is redacted (broad); the ids the reviewer must cite back (session, failure ids) are not, or broad
  // redaction would mask them too. The evidence logs were redacted when written.
  const r = (t: string) => redact(t, "broad").text;
  const used = new Set(job.evidence.skills_used.map(short));
  const flagged = new Map((curatorState(repo).flagged ?? []).map((f) => [f.name, f.reason]));
  const allSkills = [
    "## Skills this repository loads",
    ...(skills.length
      ? skills.map((s) => `- ${s.skill.name || basename(s.dir)} (${s.scope}; learned: ${s.learned}${s.skill.meta?.pinned ? "; pinned" : ""}${used.has(s.skill.name) ? "; USED this session" : ""}): ${r(s.skill.description.slice(0, 200))}`)
      : ["(none)"]),
  ];
  const facts = ["", "## Knowledge-base fact ids (for cites)", [...factIds(repo)].slice(0, 200).join(", ") || "(none)"];
  let lines: string[];
  if (job.kind === "maintenance") {
    const targets = skills.filter((s) => job.skills?.includes(s.path));
    lines = [
      `# Skill maintenance ${job.session_id} (no session)`,
      `Repository: ${basename(repo)} — top level: ${topLevel(repo).join(", ")}`,
      `Why reviewed: ${job.reason}`,
      "",
      ...allSkills,
      "",
      "## Skills to check",
      ...targets.flatMap((s) => skillBlock(repo, s, used, r, flagged.get(s.skill.name))),
      ...facts,
    ];
  } else {
    const mine = (x: Record<string, any>) => x.session_id === job.session_id && (!job.since || String(x.ts ?? "") > job.since);
    const failures = readEvidence(repo, "failures").filter(mine);
    const corrections = readEvidence(repo, "corrections").filter(mine);
    const timeline = transcriptTimeline(job.transcript_path, TIMELINE_MAX, job.since);
    const sessionText = [...failures.map((f) => `${f.command} ${f.error}`), ...corrections.map((c) => String(c.excerpt)), ...timeline].join("\n");
    lines = [
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
      ...allSkills,
      "",
      "## Skills this session touches (used, or about the same things): check these before drafting a new one",
      ...relatedSkills(skills, used, sessionText).flatMap((s) => skillBlock(repo, s, used, r, flagged.get(s.skill.name))),
      ...facts,
      "",
      "## Timeline (prompts, tool calls, errors)",
      ...timeline.map(r),
    ];
  }
  let brief = lines.join("\n");
  if (brief.length > BRIEF_MAX) brief = brief.slice(0, BRIEF_MAX) + "\n(brief cut at its size cap)";
  return brief;
}

// --- the answer ---

export interface ReviewerDraft {
  kind: "new" | "patch" | "archive";
  target?: string;
  why?: string;
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

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/;

function writeDraft(repo: string, id: string, text: string, record: DraftRecord): { id: string } {
  const dir = join(draftsDir(repo), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
  writeFileSync(join(dir, "draft.json"), JSON.stringify(record, null, 1));
  return { id };
}

/** Drafts waiting for review, as skills (for dedup). */
function pendingSkills(repo: string): { name: string; skill: ReturnType<typeof parseSkill> }[] {
  return listDrafts(repo).flatMap(({ dir, record }) => {
    try {
      return [{ name: record.name, skill: parseSkill(readFileSync(join(dir, "SKILL.md"), "utf8")) }];
    } catch {
      return [];
    }
  });
}

/**
 * A reviewer's patch or archive of a hand-written skill: kept as a suggestion for the user, never applied by the
 * loop. A patch keeps the skill's own frontmatter byte for byte and replaces only its body.
 */
function suggestDraft(repo: string, job: ReviewJob, d: ReviewerDraft, target: SkillFile): { id?: string; rejected?: string } {
  const raw = readFileSync(target.path, "utf8");
  const action = d.kind === "archive" ? "archive" : "patch";
  const why = typeof d.why === "string" ? redact(d.why, "precise").text.slice(0, 300) : undefined;
  let text = raw;
  if (action === "patch") {
    if (typeof d.body !== "string" || !d.body.trim()) return { rejected: "malformed draft" };
    const head = raw.match(FRONTMATTER)?.[0] ?? "";
    text = `${head}${head ? "\n" : ""}${redact(d.body.trim(), "precise").text}\n`;
    if (text === raw) return { rejected: `suggestion for "${d.target}" changes nothing` };
    const secrets = findSecrets(text);
    if (secrets.length) return { rejected: `lint: secrets: contains a ${secrets[0].kind}` };
  } else if (!why) return { rejected: "archive without a why" };
  const name = target.skill.name || basename(target.dir);
  const real = realPath(target.path);
  const warnings = real !== target.path ? [`the skill folder is a link: the file is ${real}${real.includes(`${join("node_modules", "")}`) ? " (inside a package: an update would undo it; change it upstream)" : ""}`] : [];
  const id = `suggest-${name}-${sha256(text + action).slice(0, 8)}`;
  return writeDraft(repo, id, text, {
    id,
    kind: "suggest",
    action,
    name,
    scope: target.scope,
    target: target.path,
    base_sha256: sha256(raw),
    ...(why ? { why } : {}),
    ...(real !== target.path ? { real_path: real } : {}),
    session_id: job.session_id,
    created: new Date().toISOString(),
    warnings,
  });
}

/**
 * Turn one reviewer draft into a draft folder, or say why not. `resolveScope` decides the final scope
 * (skill-scope.ts: deterministic rules, then Jev); the reviewer's own choice is never trusted for it.
 * v1.8: a new skill that duplicates an existing skill or a waiting draft is rejected; patch / archive of a
 * hand-written skill becomes a suggestion; archive of a learned skill is a draft like any other.
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
  if (!d || typeof d !== "object") return { rejected: "malformed draft" };
  let target: SkillFile | undefined;
  if (d.kind === "patch" || d.kind === "archive") {
    target = skills.find((s) => s.skill.name === d.target || basename(s.dir) === d.target);
    if (!target) return { rejected: `${d.kind} target "${d.target}" not found` };
    if (target.skill.meta?.pinned) return { rejected: `"${d.target}" is pinned` };
    if (!target.learned) return suggestDraft(repo, job, d, target);
    if (d.kind === "archive") {
      if (typeof d.why !== "string" || !d.why.trim()) return { rejected: "archive without a why" };
      const raw = readFileSync(target.path, "utf8");
      const id = `archive-${target.skill.name}-${sha256(raw).slice(0, 8)}`;
      return writeDraft(repo, id, raw, {
        id,
        kind: "archive",
        name: target.skill.name,
        scope: target.scope,
        target: target.path,
        base_sha256: sha256(raw),
        why: redact(d.why, "precise").text.slice(0, 300),
        session_id: job.session_id,
        created: new Date().toISOString(),
        warnings: [],
      });
    }
  }
  if (typeof d.name !== "string" || typeof d.body !== "string" || typeof d.description !== "string") return { rejected: "malformed draft" };
  const old = target?.skill.meta?.provenance;
  const prov = {
    // a patch keeps the evidence its skill was built from
    sessions: [...new Set([...(old?.sessions ?? []), job.session_id, ...strs(d.provenance?.sessions)])],
    failures: [...new Set([...(old?.failures ?? []), ...strs(d.provenance?.failures)])],
    corrections: [...new Set([...(old?.corrections ?? []), ...strs(d.provenance?.corrections)])],
  };
  // a maintenance review's evidence is the dead references and failed Verify commands in its brief
  if (job.kind !== "maintenance" && strs(d.provenance?.failures).length + strs(d.provenance?.corrections).length === 0 && job.evidence.failures.length + job.evidence.corrections === 0) {
    return { rejected: "no failure or correction behind it" };
  }
  // a patch keeps its skill's scope; a new skill's comes from the resolver
  const decision: ScopeDecision = target
    ? { scope: target.scope === "directory" ? "directory" : "project", globalCandidate: false, why: "patch: the skill's own scope" }
    : await resolveScope(d);
  const scope: SkillScope = target?.scope ?? decision.scope;
  const paths = strs(d.applies_to?.paths);
  if (decision.directory && !paths.includes(decision.directory)) paths.unshift(decision.directory);
  const name = target ? target.skill.name : d.name;
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
  if (!target && !merge) {
    const dup = duplicateOf({ name, description: d.description, meta }, [
      ...skills.map((s) => ({ name: s.skill.name || basename(s.dir), skill: s.skill })),
      ...pendingSkills(repo).map((p) => ({ ...p, name: `${p.name} (a waiting draft)` })),
    ]);
    if (dup) return { rejected: `duplicate of "${dup.other.name}" (overlap ${dup.overlap.toFixed(2)}): patch that skill instead` };
  }
  // precise: a skill is prose and code, broad would mangle ordinary identifiers
  const text = redact(renderSkill({ name, description: d.description, meta, body: d.body }), "precise").text;
  const findings = lintSkill(join(draftsDir(repo), name, "SKILL.md"), text, { projectRoot: repo, others: skills.filter((s) => s.path !== target?.path) }, name);
  const errors = findings.filter((f) => f.severity === "error");
  if (errors.length) return { rejected: `lint: ${errors.map((f) => `${f.rule}: ${f.message}`).join("; ")}` };
  const id = `${name}-${sha256(text).slice(0, 8)}`;
  const record: DraftRecord = {
    id,
    kind: merge ? "merge" : target ? "patch" : "new",
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
    indexSkill({ repo, name, path: join(draftsDir(repo), id, "SKILL.md"), status: "draft", ...(decision.globalCandidate ? { global_candidate: true } : {}) }, env);
  }
  return writeDraft(repo, id, text, record);
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
  for (const d of answer.drafts.slice(0, MAX_DRAFTS)) {
    const env = opts.env ?? process.env;
    const r = await materializeDraft(job.repo, job, d, skills, opts.resolveScope ?? ((x) => decideScope(job.repo, x, env)), env);
    if (r.id) drafts.push(r.id);
    else rejected.push({ reason: `${d?.name ?? "?"}: ${r.rejected}` });
  }
  return { drafts, rejected, costUsd: run.costUsd, note: answer.drafts.length ? undefined : answer.none_reason?.slice(0, 200) };
}

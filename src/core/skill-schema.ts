/**
 * The skill loop's skill format (v1.7): an ordinary Claude Code SKILL.md plus a `skill_loop:` frontmatter
 * block that marks it as learned and carries its scope, status and evidence. Claude Code ignores keys it
 * does not know (verified on 2.1.310), so a learned skill loads like any other. `metadata.generated_by`
 * is the string-only marker the agentskills.io spec reserves for clients.
 *
 *   ---
 *   name: <kebab-name>
 *   description: <what it does + when to use it>
 *   metadata: { generated_by: semantic-memory }
 *   skill_loop:
 *     schema: 1
 *     scope: project            # directory | project | global
 *     status: active            # draft | active | stale | archived
 *     pinned: false
 *     triggers: [...]           # literal errors / commands / phrases (not `symptoms`: hewtd #46)
 *     applies_to: { paths: [...], commands: [...] }
 *     provenance: { sessions: [...], failures: [...], corrections: [...] }
 *     cites: [<kb-fact-id>]
 *     supersedes: []
 *   ---
 *   ## When to use · ## Steps · ## Pitfalls · ## Verify
 *
 * Counters (uses, last used) never live in the file: see skill-usage.jsonl.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import YAML from "yaml";
import matter from "./matter.js";
import { findSecrets } from "./redact.js";

export const SKILL_SCOPES = ["directory", "project", "global"] as const;
export const SKILL_STATUSES = ["draft", "active", "stale", "archived"] as const;
export const SKILL_SECTIONS = ["When to use", "Steps", "Pitfalls", "Verify"] as const;
export const GENERATED_BY = "semantic-memory";

export type SkillScope = (typeof SKILL_SCOPES)[number];
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export interface SkillLoopMeta {
  schema: 1;
  scope: SkillScope;
  status: SkillStatus;
  pinned: boolean;
  triggers: string[];
  applies_to: { paths: string[]; commands: string[] };
  provenance: { sessions: string[]; failures: string[]; corrections: string[] };
  cites: string[];
  supersedes: string[];
}

export interface ParsedSkill {
  name: string;
  description: string;
  /** null when the file has no `skill_loop:` block: not a learned skill */
  meta: SkillLoopMeta | null;
  /** the raw `skill_loop` value, for lint messages on a malformed block */
  rawMeta: unknown;
  body: string;
  /** `## ` headings in the body, in order */
  sections: string[];
  frontmatter: Record<string, unknown>;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export function parseSkill(raw: string): ParsedSkill {
  let data: Record<string, any> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    data = parsed.data ?? {};
    body = parsed.content;
  } catch {
    // malformed frontmatter: Claude Code still loads the skill with no fields; lint reports it
  }
  const m = data.skill_loop;
  const meta: SkillLoopMeta | null =
    m && typeof m === "object"
      ? {
          schema: m.schema,
          scope: m.scope,
          status: m.status,
          pinned: m.pinned === true,
          triggers: strings(m.triggers),
          applies_to: { paths: strings(m.applies_to?.paths), commands: strings(m.applies_to?.commands) },
          provenance: {
            sessions: strings(m.provenance?.sessions),
            failures: strings(m.provenance?.failures),
            corrections: strings(m.provenance?.corrections),
          },
          cites: strings(m.cites),
          supersedes: strings(m.supersedes),
        }
      : null;
  return {
    name: typeof data.name === "string" ? data.name : "",
    description: typeof data.description === "string" ? data.description : "",
    meta,
    rawMeta: m,
    body,
    sections: [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((x) => x[1]),
    frontmatter: data,
  };
}

/** A learned skill's SKILL.md text. Field order is fixed so a re-render of an unchanged skill is byte-identical. */
export function renderSkill(skill: { name: string; description: string; meta: SkillLoopMeta; body: string; extra?: Record<string, unknown> }): string {
  const fm = {
    name: skill.name,
    description: skill.description,
    ...(skill.extra ?? {}),
    metadata: { generated_by: GENERATED_BY },
    skill_loop: {
      schema: 1,
      scope: skill.meta.scope,
      status: skill.meta.status,
      pinned: skill.meta.pinned,
      triggers: skill.meta.triggers,
      applies_to: skill.meta.applies_to,
      provenance: skill.meta.provenance,
      cites: skill.meta.cites,
      supersedes: skill.meta.supersedes,
    },
  };
  return `---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n\n${skill.body.trim()}\n`;
}

// --- discovery ---

export interface SkillFile {
  path: string;
  /** directory holding SKILL.md; its basename is the skill's name in Claude Code */
  dir: string;
  scope: SkillScope;
  learned: boolean;
  skill: ParsedSkill;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".semantic-sidekick-index", ".planning"]);

function skillsIn(skillsDir: string, scope: SkillScope): SkillFile[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const out: SkillFile[] = [];
  for (const e of entries) {
    const path = join(skillsDir, e, "SKILL.md");
    try {
      const skill = parseSkill(readFileSync(path, "utf8"));
      out.push({ path, dir: join(skillsDir, e), scope, learned: isLearned(skill), skill });
    } catch {}
  }
  return out;
}

export const isLearned = (s: ParsedSkill) =>
  s.meta !== null || (s.frontmatter.metadata as Record<string, unknown> | undefined)?.generated_by === GENERATED_BY;

/** `<subdir>/.claude/skills` folders below the repo root (not the root's own), skipping vendored trees. */
function directorySkillDirs(root: string, depth = 6): string[] {
  const out: string[] = [];
  const walk = (dir: string, d: number) => {
    if (d > depth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e) || (e.startsWith(".") && e !== ".claude")) continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (e === ".claude") {
        if (dir !== root && existsSync(join(p, "skills"))) out.push(join(p, "skills"));
        continue;
      }
      walk(p, d + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** Every skill Claude Code would load for this repo: directory, project and global scope. */
export function findSkills(projectRoot: string, opts: { home?: string; global?: boolean } = {}): SkillFile[] {
  const home = opts.home ?? process.env.HOME ?? homedir();
  return [
    ...skillsIn(join(projectRoot, ".claude", "skills"), "project"),
    ...directorySkillDirs(projectRoot).flatMap((d) => skillsIn(d, "directory")),
    ...(opts.global === false ? [] : skillsIn(join(home, ".claude", "skills"), "global")),
  ];
}

/** Knowledge-base fact ids (file basenames) in this repo, for `cites`. */
export function factIds(projectRoot: string): Set<string> {
  let kb = join(projectRoot, ".documentation", "knowledge-base");
  try {
    const cfg = JSON.parse(readFileSync(join(projectRoot, ".claude", "hit-em-with-the-docs.json"), "utf8"));
    if (typeof cfg?.vault?.root === "string") kb = join(projectRoot, cfg.vault.root);
  } catch {}
  try {
    return new Set(readdirSync(join(kb, "facts")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
  } catch {
    return new Set();
  }
}

// --- lint ---

export interface SkillFinding {
  path: string;
  rule:
    | "frontmatter"
    | "name"
    | "description"
    | "skill_loop"
    | "provenance"
    | "sections"
    | "cites"
    | "applies_to"
    | "secrets"
    | "name_clash";
  severity: "error" | "warn";
  message: string;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// verbs that say nothing about what the skill does: Claude cannot tell when to load it
const VAGUE = /\b(helps? with|handles?|deals? with|manages?|various|stuff|things|misc(ellaneous)?|general purpose)\b/i;
const DESCRIPTION_MAX = 1024;
const DESCRIPTION_MIN = 40;

export interface SkillLintContext {
  /** repo root the skill belongs to (applies_to paths resolve against it) */
  projectRoot: string;
  facts?: Set<string>;
  /** every other skill Claude Code would load alongside (for name clashes) */
  others?: SkillFile[];
}

/** Lint one learned skill. `dirName` is the folder name Claude Code will use (defaults to the skill's name). */
export function lintSkill(path: string, raw: string, ctx: SkillLintContext, dirName?: string): SkillFinding[] {
  const out: SkillFinding[] = [];
  const add = (rule: SkillFinding["rule"], severity: SkillFinding["severity"], message: string) => out.push({ path, rule, severity, message });
  const s = parseSkill(raw);
  if (!raw.startsWith("---")) add("frontmatter", "error", "no YAML frontmatter");
  if (!s.name) add("name", "error", "missing `name`");
  else if (!NAME_RE.test(s.name) || s.name.length > 64) add("name", "error", `name "${s.name}" is not kebab-case (a-z, 0-9, -; at most 64)`);
  else if (dirName && dirName !== s.name) add("name", "error", `name "${s.name}" differs from its folder "${dirName}"`);

  const d = s.description.trim();
  if (!d) add("description", "error", "missing `description` (the only text Claude sees before loading the skill)");
  else {
    if (d.length < DESCRIPTION_MIN) add("description", "error", `description is ${d.length} chars; say what it does and when to use it (>= ${DESCRIPTION_MIN})`);
    if (d.length > DESCRIPTION_MAX) add("description", "error", `description is ${d.length} chars (max ${DESCRIPTION_MAX})`);
    if (!/\bwhen\b|\bbefore\b|\bafter\b|\bif\b/i.test(d)) add("description", "error", "description does not say when to use it (e.g. \"Use when …\")");
    if (VAGUE.test(d)) add("description", "warn", `description uses a vague verb ("${d.match(VAGUE)![0]}"): name the concrete action`);
  }

  const m = s.meta;
  if (!m) {
    add("skill_loop", "error", "missing `skill_loop:` block");
    return out;
  }
  if (m.schema !== 1) add("skill_loop", "error", `skill_loop.schema must be 1 (got ${JSON.stringify(m.schema)})`);
  if (!SKILL_SCOPES.includes(m.scope)) add("skill_loop", "error", `skill_loop.scope must be one of ${SKILL_SCOPES.join(", ")}`);
  if (!SKILL_STATUSES.includes(m.status)) add("skill_loop", "error", `skill_loop.status must be one of ${SKILL_STATUSES.join(", ")}`);
  if (m.triggers.length === 0) add("skill_loop", "warn", "no `triggers`: list the literal errors, commands or phrases this skill answers");
  const evidence = m.provenance.sessions.length + m.provenance.failures.length + m.provenance.corrections.length;
  if (evidence === 0) add("provenance", "error", "no provenance: a learned skill needs the session, failure or correction it came from");

  for (const want of SKILL_SECTIONS) {
    if (!s.sections.some((h) => h.toLowerCase() === want.toLowerCase())) add("sections", "error", `missing section "## ${want}"`);
  }

  // a global skill serves every repo: its facts are not this repo's, so cites resolve only for directory / project
  if (m.cites.length && m.scope !== "global") {
    const facts = ctx.facts ?? factIds(ctx.projectRoot);
    for (const c of m.cites) if (!facts.has(c.replace(/\.md$/, "").split("/").pop()!)) add("cites", "error", `cites "${c}", which is not a knowledge-base fact here`);
  }

  if (m.scope !== "global") {
    for (const p of m.applies_to.paths) {
      if (!existsSync(join(ctx.projectRoot, p))) add("applies_to", "error", `applies_to path "${p}" does not exist in this repo`);
    }
    if (m.scope === "directory" && m.applies_to.paths.length === 0) add("applies_to", "error", "a directory-scoped skill needs applies_to.paths");
  }

  for (const hit of findSecrets(raw)) add("secrets", "error", `contains a ${hit.kind} at line ${hit.line}`);

  if (s.name) {
    for (const o of ctx.others ?? []) {
      if (o.path === path || o.learned) continue;
      if (basename(o.dir) === s.name || o.skill.name === s.name) {
        add("name_clash", "error", `a ${o.scope} skill not written by the skill loop already uses the name "${s.name}" (${o.path})`);
      }
    }
  }
  return out;
}

/** Lint every learned skill this repo would load (and its drafts, when given). */
export function lintSkills(projectRoot: string, opts: { home?: string; extra?: string[] } = {}): { files: number; findings: SkillFinding[] } {
  const all = findSkills(projectRoot, { home: opts.home });
  const facts = factIds(projectRoot);
  const findings: SkillFinding[] = [];
  let files = 0;
  for (const f of all.filter((x) => x.learned)) {
    files++;
    findings.push(...lintSkill(f.path, readFileSync(f.path, "utf8"), { projectRoot, facts, others: all }, basename(f.dir)));
  }
  for (const p of opts.extra ?? []) {
    files++;
    findings.push(...lintSkill(p, readFileSync(p, "utf8"), { projectRoot, facts, others: all }));
  }
  return { files, findings };
}

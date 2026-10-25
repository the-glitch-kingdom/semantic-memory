/**
 * The skill loop's curator (v1.7): keeps learned skills from piling up. Deterministic — no model call:
 *
 *  - a learned skill unused for 14 days becomes `stale`; for 30 days it is archived to
 *    .claude/.semantic-memory/skills-archive/<name>/ (outside .claude/skills/, so Claude Code stops loading it)
 *  - a stale skill that is used again goes back to `active`
 *  - skipped: pinned skills, skills another skill cites or supersedes, never-used skills younger than 14 days,
 *    and every skill the loop did not write
 *
 * Runs idle-triggered from SessionStart (every 7 days, when the repo has been quiet >= 2 h, never in the first
 * 7 days after the loop first saw the repo) or by hand. Every change is a ledger entry; `restore` brings an
 * archived skill back. Merging is separate and opt-in (skill-merge.ts).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readEvidence, stateDir } from "./skill-evidence.js";
import { applyChange, archiveDir, readLedger, type LedgerEntry } from "./skill-ledger.js";
import { findSkills, parseSkill, renderSkill, type SkillFile } from "./skill-schema.js";
import { indexSkill } from "./skill-scope.js";
import { parseVerify } from "./skill-eval/task.js";

export const STALE_DAYS = 14;
export const ARCHIVE_DAYS = 30;
export const CURATOR_INTERVAL_DAYS = 7;
export const IDLE_HOURS = 2;
const DAY = 86_400_000;

export const curatorStatePath = (repo: string) => join(stateDir(repo), "curator.json");

interface CuratorState {
  first_seen?: string;
  last_run?: string;
  last_report?: string;
  flagged?: { name: string; reason: string; at: string }[];
}

function readState(repo: string): CuratorState {
  try {
    return JSON.parse(readFileSync(curatorStatePath(repo), "utf8"));
  } catch {
    return {};
  }
}
function writeState(repo: string, s: CuratorState) {
  mkdirSync(stateDir(repo), { recursive: true });
  writeFileSync(curatorStatePath(repo), JSON.stringify(s, null, 1));
}

export interface CuratorAction {
  skill: string;
  path: string;
  action: "stale" | "archive" | "reactivate" | "skip";
  why: string;
}

/** When the skill was last used here (ms), from skill-usage.jsonl; null if never. */
function lastUsed(repo: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const u of readEvidence(repo, "usage")) {
    const t = Date.parse(String(u.ts));
    const name = String(u.skill).split(":").pop()!;
    if (Number.isFinite(t) && t > (m.get(name) ?? 0)) m.set(name, t);
  }
  return m;
}

/** When the skill landed here (ms): its ledger entry, else the file's mtime. */
function landedAt(s: SkillFile, ledger: LedgerEntry[]): number {
  const e = ledger.filter((x) => x.skill === s.skill.name && ["land", "patch", "restore", "merge", "promote"].includes(x.action)).pop();
  return e ? Date.parse(e.ts) : statSync(s.path).mtimeMs;
}

export function plan(repo: string, now = Date.now(), env = process.env): CuratorAction[] {
  const all = findSkills(repo, { home: env.HOME, global: false });
  const learned = all.filter((s) => s.learned && s.skill.meta);
  const used = lastUsed(repo);
  const ledger = readLedger(repo);
  // a skill another one cites or supersedes is still load-bearing
  const referenced = new Set(learned.flatMap((s) => [...(s.skill.meta!.supersedes ?? []), ...s.skill.meta!.cites].map((x) => x.split("/").pop()!.replace(/\.md$/, ""))));
  for (const s of all) for (const o of learned) if (s !== o && s.skill.body.includes(`/${o.skill.name}`)) referenced.add(o.skill.name);
  const out: CuratorAction[] = [];
  for (const s of learned) {
    const name = s.skill.name;
    const meta = s.skill.meta!;
    const base = { skill: name, path: s.path };
    if (meta.pinned) { out.push({ ...base, action: "skip", why: "pinned" }); continue; }
    if (referenced.has(name)) { out.push({ ...base, action: "skip", why: "cited by another skill" }); continue; }
    const last = used.get(name);
    const since = last ?? landedAt(s, ledger);
    const idle = (now - since) / DAY;
    if (last === undefined && idle < STALE_DAYS) { out.push({ ...base, action: "skip", why: `never used, landed ${idle.toFixed(0)} d ago` }); continue; }
    if (idle >= ARCHIVE_DAYS) out.push({ ...base, action: "archive", why: `unused ${Math.floor(idle)} days` });
    else if (idle >= STALE_DAYS && meta.status === "active") out.push({ ...base, action: "stale", why: `unused ${Math.floor(idle)} days` });
    else if (idle < STALE_DAYS && meta.status === "stale") out.push({ ...base, action: "reactivate", why: `used ${Math.floor(idle)} days ago` });
  }
  return out;
}

const withStatus = (raw: string, status: "active" | "stale" | "archived") => {
  const s = parseSkill(raw);
  return renderSkill({ name: s.name, description: s.description, meta: { ...s.meta!, status }, body: s.body });
};

/** Run the curator. Dry run: report only. Returns the actions (and the ledger ids of the changes made). */
export function curate(repo: string, opts: { dryRun?: boolean; now?: number; env?: NodeJS.ProcessEnv } = {}): { actions: CuratorAction[]; ledger: string[] } {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const actions = plan(repo, now, env);
  const ids: string[] = [];
  if (!opts.dryRun) {
    for (const a of actions) {
      if (a.action === "skip") continue;
      const raw = readFileSync(a.path, "utf8");
      if (a.action === "archive") {
        const dest = join(archiveDir(repo), a.skill, "SKILL.md");
        ids.push(applyChange(repo, { action: "archive", actor: "curator", skill: a.skill, why: a.why }, [
          { path: dest, content: withStatus(raw, "archived") },
          { path: a.path, content: null },
        ]).id);
        indexSkill({ repo, name: a.skill, path: a.path, status: "archived" }, env);
      } else {
        const status = a.action === "stale" ? "stale" : "active";
        ids.push(applyChange(repo, { action: a.action === "stale" ? "stale" : "restore", actor: "curator", skill: a.skill, why: a.why }, [{ path: a.path, content: withStatus(raw, status) }]).id);
      }
    }
    const st = readState(repo);
    writeState(repo, { ...st, last_run: new Date(now).toISOString(), last_report: actions.filter((a) => a.action !== "skip").map((a) => `${a.action} ${a.skill}`).join(", ") || "nothing to do" });
  }
  return { actions, ledger: ids };
}

/** Whether SessionStart should start the curator now (and records first sight of the repo). */
export function curatorDue(repo: string, now = Date.now()): boolean {
  const st = readState(repo);
  if (!st.first_seen) {
    writeState(repo, { ...st, first_seen: new Date(now).toISOString() });
    return false;
  }
  if (now - Date.parse(st.first_seen) < CURATOR_INTERVAL_DAYS * DAY) return false;
  if (st.last_run && now - Date.parse(st.last_run) < CURATOR_INTERVAL_DAYS * DAY) return false;
  // quiet: the last thing the loop recorded here is >= 2 h old (the session starting now is not activity yet)
  let last = 0;
  for (const f of ["skill-usage.jsonl", "failures.jsonl", "corrections.jsonl"]) {
    try {
      last = Math.max(last, statSync(join(stateDir(repo), f)).mtimeMs);
    } catch {}
  }
  return now - last >= IDLE_HOURS * 3_600_000;
}

/** Bring an archived skill back where it was, active again. */
export function restore(repo: string, name: string): LedgerEntry {
  const archived = join(archiveDir(repo), name, "SKILL.md");
  if (!existsSync(archived)) throw new Error(`no archived skill "${name}" (archived: ${listArchived(repo).join(", ") || "none"})`);
  const from = readLedger(repo).filter((e) => e.action === "archive" && e.skill === name).pop();
  const original = from?.files.find((f) => f.after === null)?.path ?? join(repo, ".claude", "skills", name, "SKILL.md");
  if (existsSync(original)) throw new Error(`${original} exists already`);
  return applyChange(repo, { action: "restore", actor: "user", skill: name, why: "restored from skills-archive" }, [
    { path: original, content: withStatus(readFileSync(archived, "utf8"), "active") },
    { path: archived, content: null },
  ]);
}

export function listArchived(repo: string): string[] {
  try {
    return readdirSync(archiveDir(repo)).filter((d) => existsSync(join(archiveDir(repo), d, "SKILL.md")));
  } catch {
    return [];
  }
}

/** Run each landed learned skill's Verify command (they were approved by a person); flag failures, archive nothing. */
export function verifySkills(repo: string, opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): { skill: string; result: "pass" | "fail" | "prose" | "none"; detail: string }[] {
  const out: { skill: string; result: "pass" | "fail" | "prose" | "none"; detail: string }[] = [];
  for (const s of findSkills(repo, { home: opts.env?.HOME, global: false }).filter((x) => x.learned)) {
    const v = parseVerify(s.skill.body);
    if (v.kind !== "command") {
      out.push({ skill: s.skill.name, result: v.kind === "prose" ? "prose" : "none", detail: v.kind === "prose" ? v.text.slice(0, 120) : "no ## Verify" });
      continue;
    }
    const r = spawnSync("bash", ["-c", v.command], { cwd: repo, timeout: opts.timeoutMs ?? 120_000, encoding: "utf8", env: opts.env ?? process.env });
    out.push({ skill: s.skill.name, result: r.status === 0 ? "pass" : "fail", detail: r.status === 0 ? v.command : `${v.command} → exit ${r.status}: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}` });
  }
  const st = readState(repo);
  writeState(repo, { ...st, flagged: out.filter((x) => x.result === "fail").map((x) => ({ name: x.skill, reason: x.detail, at: new Date().toISOString() })) });
  return out;
}

export const curatorState = readState;

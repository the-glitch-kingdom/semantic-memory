/**
 * Where a learned skill lives (v1.7): directory, project, or — only by promotion — global.
 *
 *  1. Deterministic first: a draft that names this repo's paths is project-scoped; one whose paths all sit
 *     under a single subdirectory is directory-scoped there.
 *  2. Unresolved (names nothing in the repo): in jev mode one batch Jev question, "is this true in any
 *     repository?"; a yes at >= 0.95 only marks the draft a global *candidate*. Otherwise: project.
 *  3. Global only by promotion: when the cross-repo index shows the same skill name drafted or landed in
 *     >= 2 repos, review offers one global skill that replaces the project copies. A person approves it.
 *
 * Private repos (SEMANTIC_MEMORY_PRIVATE_PATHS, default ~/workspace/kentro: a Claude-only boundary) are
 * always project, are never written to the cross-repo index, and never reach Jev.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { featureOn } from "./features.js";
import { askJev, jevVerdict } from "./jev.js";
import { smHome } from "./skill-queue.js";
import type { SkillScope } from "./skill-schema.js";

export interface ScopeDecision {
  scope: Exclude<SkillScope, "global">;
  /** directory scope: the subdirectory (repo-relative) */
  directory?: string;
  /** Jev said this holds in any repo: offer promotion once another repo has it too */
  globalCandidate: boolean;
  why: string;
}

export function privatePaths(env = process.env): string[] {
  const home = env.HOME || homedir();
  return (env.SEMANTIC_MEMORY_PRIVATE_PATHS ?? "~/workspace/kentro")
    .split(",")
    .map((p) => p.trim().replace(/^~(?=$|\/)/, home))
    .filter(Boolean);
}

export const isPrivateRepo = (repo: string, env = process.env) =>
  privatePaths(env).some((p) => repo === p || repo.startsWith(p.endsWith(sep) ? p : p + sep));

/** Repo-relative paths a draft mentions that exist in the repo (from applies_to.paths and path-like tokens). */
export function repoReferences(repo: string, text: string, paths: string[] = []): string[] {
  const tokens = new Set(paths);
  for (const m of text.matchAll(/(?:^|[\s`'"(])((?:\.\/)?[\w.@-]+(?:\/[\w.@-]+)+\/?|[\w-]+\.(?:sh|js|mjs|ts|py|json|toml|ya?ml|md))(?=[\s`'"),:;]|$)/gm)) {
    tokens.add(m[1].replace(/^\.\//, "").replace(/\/$/, ""));
  }
  return [...tokens].filter((p) => p && !p.startsWith("/") && !p.startsWith("~") && !p.includes("..") && existsSync(join(repo, p)));
}

/** The one subdirectory every referenced path sits under (two levels at most), or null. */
function commonSubdir(repo: string, refs: string[]): string | null {
  const dirs = refs.map((r) => {
    let isDir = false;
    try {
      isDir = statSync(join(repo, r)).isDirectory();
    } catch {}
    const parts = r.split("/");
    return (isDir ? parts : parts.slice(0, -1)).slice(0, 2).join("/");
  });
  if (!dirs.length || dirs.some((d) => !d)) return null;
  const first = dirs[0];
  return dirs.every((d) => d === first || d.startsWith(first + "/")) ? first : null;
}

export const SCOPE_QUESTION =
  "Would these steps work unchanged in any software repository — they name no file, script, package, service or " +
  "setting that belongs to one particular repository?";

export async function decideScope(
  repo: string,
  draft: { name: string; description: string; body: string; applies_to?: { paths?: string[] } },
  env = process.env,
): Promise<ScopeDecision> {
  const refs = repoReferences(repo, `${draft.description}\n${draft.body}`, draft.applies_to?.paths ?? []);
  if (refs.length) {
    const sub = commonSubdir(repo, refs);
    // a subdir that holds its own package/skills is a real unit; a bare src/ or scripts/ is still the whole project
    if (sub && (existsSync(join(repo, sub, "package.json")) || existsSync(join(repo, sub, ".claude")) || existsSync(join(repo, sub, "pyproject.toml")))) {
      return { scope: "directory", directory: sub, globalCandidate: false, why: `every path it names is under ${sub}/` };
    }
    return { scope: "project", globalCandidate: false, why: `names this repo's ${refs.slice(0, 3).join(", ")}` };
  }
  if (isPrivateRepo(repo, env)) return { scope: "project", globalCandidate: false, why: "private repo: stays here" };
  if (!featureOn("jev", repo, env)) return { scope: "project", globalCandidate: false, why: "names nothing in the repo; jev mode off → project" };
  const a = await askJev(
    {
      cwd: repo,
      caller: "semantic-memory-skill-loop",
      state: `Skill ${draft.name}: ${draft.description}\n\n${draft.body}`.slice(0, 2000),
      questions: [{ key: "global", instructions: SCOPE_QUESTION }],
    },
    { env, timeoutMs: 30_000 },
  );
  const yes = jevVerdict(a.scores.global) === true;
  return {
    scope: "project",
    globalCandidate: yes,
    why: yes ? `Jev: holds in any repo (p=${a.scores.global?.toFixed(2)}); promotion needs a second repo` : `names nothing in the repo; Jev not sure it is general (${a.error ?? `p=${a.scores.global?.toFixed(2)}`}) → project`,
  };
}

// --- the cross-repo index: paths and names only ---

export interface IndexEntry {
  repo: string;
  name: string;
  path: string;
  status: "draft" | "active" | "archived";
  global_candidate?: boolean;
  ts: string;
}

export const skillIndexPath = (env = process.env) => join(smHome(env), "skill-index.jsonl");

export function indexSkill(e: Omit<IndexEntry, "ts">, env = process.env): void {
  if (isPrivateRepo(e.repo, env)) return;
  mkdirSync(smHome(env), { recursive: true });
  appendFileSync(skillIndexPath(env), JSON.stringify({ ...e, ts: new Date().toISOString() }) + "\n");
}

/** Latest entry per (repo, name, path). */
export function readIndex(env = process.env): IndexEntry[] {
  const latest = new Map<string, IndexEntry>();
  let raw = "";
  try {
    raw = readFileSync(skillIndexPath(env), "utf8");
  } catch {
    return [];
  }
  for (const line of raw.split("\n")) {
    try {
      const e = JSON.parse(line) as IndexEntry;
      latest.set(`${e.repo}\0${e.name}\0${e.path}`, e);
    } catch {}
  }
  return [...latest.values()];
}

const nameTokens = (n: string) => new Set(n.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));

/** Same lesson: the same name, or names sharing >= 3/4 of their words. */
export function sameLesson(a: string, b: string): boolean {
  if (a === b) return true;
  const x = nameTokens(a), y = nameTokens(b);
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / Math.max(x.size, y.size, 1) >= 0.75;
}

/** Other repos holding the same lesson (not archived). Promotion is offered when this returns >= 1 repo. */
export function promotionPeers(repo: string, name: string, env = process.env): IndexEntry[] {
  if (isPrivateRepo(repo, env)) return [];
  return readIndex(env).filter((e) => e.repo !== repo && e.status !== "archived" && sameLesson(e.name, name) && !isPrivateRepo(e.repo, env));
}

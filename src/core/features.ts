/**
 * The v1.7 feature switches, both off by default (v1.7):
 *
 *  - skill loop (`SEMANTIC_MEMORY_SKILL_LOOP=1`): learn procedures as skills between sessions. A repo can
 *    override the global switch with `skill_loop: on | off` in `<repo>/.claude/.semantic-memory/config`.
 *  - jev mode (`SEMANTIC_MEMORY_JEV=1`): answer closed-set decisions with Jev through jev-loop. Env only.
 *
 * Standalone (no embedder, no vault): hooks import it from dist/core/features.js on every event, so it
 * must stay cheap — a few stat/read calls.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import YAML from "yaml";

export type Feature = "skill_loop" | "jev";

export interface FeatureState {
  feature: Feature;
  on: boolean;
  /** Where the on/off came from. */
  why: "default" | "env" | "repo";
  /** jev only: whether jev-loop, the key and python are present. Always true for the skill loop. */
  available: boolean;
  /** Why it is unavailable, when it is on but cannot run. */
  reason?: string;
}

export const ENV: Record<Feature, string> = { skill_loop: "SEMANTIC_MEMORY_SKILL_LOOP", jev: "SEMANTIC_MEMORY_JEV" };

const truthy = (v: unknown) => v === true || v === 1 || (typeof v === "string" && /^(1|on|true|yes)$/i.test(v.trim()));
const falsy = (v: unknown) => v === false || v === 0 || (typeof v === "string" && /^(0|off|false|no)$/i.test(v.trim()));

export const repoConfigPath = (projectRoot: string) => join(projectRoot, ".claude", ".semantic-memory", "config");

/** `<repo>/.claude/.semantic-memory/config` as an object ({} when missing or unparseable). */
export function readRepoConfig(projectRoot: string): Record<string, unknown> {
  try {
    const data = YAML.parse(readFileSync(repoConfigPath(projectRoot), "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export const jevLoopDir = (env = process.env) => env.JEV_LOOP_DIR || join(env.HOME || homedir(), ".claude", "jev-loop");
export const claudeSettingsPath = (env = process.env) =>
  env.SEMANTIC_MEMORY_CLAUDE_SETTINGS || join(env.HOME || homedir(), ".claude", "settings.json");

function onPath(bin: string, env = process.env): boolean {
  return (env.PATH || "").split(delimiter).some((d) => d && existsSync(join(d, bin)));
}

/** Whether jev mode could run: jev-loop's router, the TypeSafe key (env or settings, never read out), python3. */
export function jevAvailable(env = process.env): { available: boolean; reason?: string } {
  const dir = jevLoopDir(env);
  if (!existsSync(join(dir, "router.py"))) return { available: false, reason: `jev-loop not found at ${dir} (router.py missing; set JEV_LOOP_DIR)` };
  if (!env.TYPESAFE_API_KEY) {
    let inSettings = false;
    try {
      inSettings = Boolean(JSON.parse(readFileSync(claudeSettingsPath(env), "utf8"))?.env?.TYPESAFE_API_KEY);
    } catch {}
    if (!inSettings) return { available: false, reason: "TYPESAFE_API_KEY is not set (env or ~/.claude/settings.json env)" };
  }
  if (!onPath("python3", env)) return { available: false, reason: "python3 not found on PATH" };
  return { available: true };
}

export function featureState(feature: Feature, projectRoot?: string, env = process.env): FeatureState {
  let on = false;
  let why: FeatureState["why"] = "default";
  const raw = env[ENV[feature]];
  if (raw !== undefined && raw !== "") {
    on = truthy(raw);
    why = "env";
  }
  if (feature === "skill_loop" && projectRoot) {
    const repo = readRepoConfig(projectRoot).skill_loop;
    if (truthy(repo) || falsy(repo)) {
      on = truthy(repo);
      why = "repo";
    }
  }
  if (feature === "jev" && on) {
    const a = jevAvailable(env);
    return { feature, on, why, ...a };
  }
  return { feature, on, why, available: true };
}

/** On and able to run. The check every hook path makes first. */
export const featureOn = (feature: Feature, projectRoot?: string, env = process.env) => {
  const s = featureState(feature, projectRoot, env);
  return s.on && s.available;
};

/**
 * Set (true / false) or clear (undefined) one env key in ~/.claude/settings.json, touching nothing else.
 * Keeps a `.bak` of the previous file. Refuses (throws, writes nothing) when the file is not valid JSON.
 */
export function setSettingsEnv(key: string, value: string | undefined, env = process.env): { path: string; backup?: string } {
  const path = claudeSettingsPath(env);
  let data: Record<string, any> = {};
  let raw: string | undefined;
  if (existsSync(path)) {
    raw = readFileSync(path, "utf8");
    try {
      data = raw.trim() ? JSON.parse(raw) : {};
    } catch (e) {
      throw new Error(`${path} is not valid JSON (${(e as Error).message}); not changed`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${path} is not a JSON object; not changed`);
  }
  if (data.env !== undefined && (typeof data.env !== "object" || data.env === null || Array.isArray(data.env))) {
    throw new Error(`${path}: "env" is not an object; not changed`);
  }
  const nextEnv = { ...(data.env ?? {}) };
  if (value === undefined) delete nextEnv[key];
  else nextEnv[key] = value;
  data.env = nextEnv;
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (raw !== undefined) {
    backup = `${path}.bak`;
    copyFileSync(path, backup);
  }
  const indent = raw?.match(/^[{\[]\s*\n([ \t]+)/)?.[1] ?? "  ";
  writeFileSync(path, JSON.stringify(data, null, indent) + "\n");
  return { path, backup };
}

/** Set or clear `<key>: <value>` in the repo config, keeping the other keys. */
export function setRepoConfig(projectRoot: string, key: string, value: string | boolean | undefined): string {
  const path = repoConfigPath(projectRoot);
  const data = readRepoConfig(projectRoot);
  if (value === undefined) delete data[key];
  else data[key] = value;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Object.keys(data).length ? YAML.stringify(data) : "");
  return path;
}

export function describeFeature(s: FeatureState): string {
  const name = s.feature === "skill_loop" ? "skill loop" : "jev mode";
  const src = s.why === "default" ? "default" : s.why === "env" ? `env ${ENV[s.feature]}` : "repo override in .claude/.semantic-memory/config";
  if (s.on && !s.available) return `${name}: on but unavailable (${s.reason}) [${src}]`;
  return `${name}: ${s.on ? "on" : "off"} [${src}]`;
}

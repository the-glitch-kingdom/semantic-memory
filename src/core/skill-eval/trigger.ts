/**
 * Trigger eval (v1.7): does Claude reach for the skill when it should, and stay away when it should not?
 * Each prompt runs in a scratch directory (outside the repo) holding the skill under test next to copies of
 * the repo's other skills, so it competes like it would for real. Up to 3 runs per prompt, stopping once the
 * first two agree. Results are cached by (sha256 of the skill file, prompt): an unchanged skill costs no runs.
 */
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runClaude, skillsCalled } from "../claude-run.js";
import { parseSkill } from "../skill-schema.js";
import type { EvalPrompt } from "./sets.js";

export const MAX_TRIGGER_RUNS = 3;

export const evalCachePath = (env = process.env) =>
  env.SEMANTIC_MEMORY_SKILL_EVAL_CACHE || join(env.HOME || homedir(), ".semantic-memory", "skill-eval-cache.jsonl");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface PromptTrigger extends EvalPrompt {
  triggers: number;
  runs: number;
  /** a majority of the runs called the skill */
  triggered: boolean;
  cached: boolean;
  error?: string;
}

export interface Rates {
  n: number;
  /** share of should-trigger prompts that triggered; null when there are none */
  positiveRate: number | null;
  /** share of near-miss prompts that triggered; null when there are none */
  falseTriggerRate: number | null;
  /** prompts that behaved as expected / n */
  accuracy: number | null;
}

export interface TriggerReport {
  skill: string;
  results: PromptTrigger[];
  train: Rates;
  heldout: Rates;
  /** claude runs started (0 when everything was cached) */
  runs: number;
}

const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

export function ratesOf(rs: PromptTrigger[]): Rates {
  return {
    n: rs.length,
    positiveRate: rate(rs.filter((r) => r.should_trigger).map((r) => r.triggered)),
    falseTriggerRate: rate(rs.filter((r) => !r.should_trigger).map((r) => r.triggered)),
    accuracy: rate(rs.map((r) => r.triggered === r.should_trigger)),
  };
}

/** A scratch dir with the skill under test and copies of the repo's other project skills. The caller removes it. */
export function makeScratch(repoRoot: string, name: string, skillRaw: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sm-skill-eval-"));
  const skills = join(dir, ".claude", "skills");
  const src = join(repoRoot, ".claude", "skills");
  if (existsSync(src)) {
    for (const e of readdirSync(src)) if (e !== name) cpSync(join(src, e), join(skills, e), { recursive: true });
  }
  mkdirSync(join(skills, name), { recursive: true });
  writeFileSync(join(skills, name, "SKILL.md"), skillRaw);
  return dir;
}

type Cache = Map<string, { triggers: number; runs: number }>;
// prompts come from real sessions: the cache (in $HOME, shared by every repo) keeps only their hash
const cacheKey = (hash: string, prompt: string) => `${hash}\n${sha256(prompt)}`;

function loadCache(path: string): Cache {
  const m: Cache = new Map();
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {}
  for (const line of raw.split("\n")) {
    try {
      const r = JSON.parse(line);
      m.set(`${r.skill}\n${r.prompt}`, { triggers: r.triggers, runs: r.runs });
    } catch {}
  }
  return m;
}

export interface TriggerOptions {
  repoRoot: string;
  /** the skill file as it is on disk (or a candidate version of it) */
  skillRaw: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export async function runTrigger(prompts: EvalPrompt[], o: TriggerOptions): Promise<TriggerReport> {
  const env = o.env ?? process.env;
  const skill = parseSkill(o.skillRaw);
  const hash = sha256(o.skillRaw);
  const cachePath = evalCachePath(env);
  const cache = loadCache(cachePath);
  const scratch = makeScratch(o.repoRoot, skill.name, o.skillRaw);
  let started = 0;
  const callOnce = async (text: string): Promise<boolean | string> => {
    started++;
    const r = await runClaude({ prompt: text, cwd: scratch, tools: ["Skill", "Read", "Glob", "Grep"], maxTurns: 2, output: "stream-json", env, timeoutMs: o.timeoutMs });
    return r.ok ? skillsCalled(r.events).includes(skill.name) : (r.error ?? "claude failed");
  };
  try {
    const results = await Promise.all(
      prompts.map(async (p): Promise<PromptTrigger> => {
        const hit = cache.get(cacheKey(hash, p.text));
        if (hit) return { ...p, ...hit, triggered: hit.triggers * 2 > hit.runs, cached: true };
        const votes: boolean[] = [];
        let error: string | undefined;
        // errored runs are retried inside the same budget of attempts, never counted as a vote
        for (let attempt = 0; attempt < MAX_TRIGGER_RUNS + 1 && votes.length < MAX_TRIGGER_RUNS; attempt++) {
          if (votes.length === 2 && votes[0] === votes[1]) break;
          const v = await callOnce(p.text);
          if (typeof v === "string") error = v;
          else votes.push(v);
        }
        const triggers = votes.filter(Boolean).length;
        if (votes.length) {
          mkdirSync(dirname(cachePath), { recursive: true });
          appendFileSync(cachePath, JSON.stringify({ skill: hash, prompt: sha256(p.text), triggers, runs: votes.length }) + "\n");
        }
        return { ...p, triggers, runs: votes.length, triggered: triggers * 2 > votes.length, cached: false, ...(votes.length ? {} : { error }) };
      }),
    );
    return {
      skill: skill.name,
      results,
      train: ratesOf(results.filter((r) => r.split === "train")),
      heldout: ratesOf(results.filter((r) => r.split === "heldout")),
      runs: started,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

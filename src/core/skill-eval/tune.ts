/**
 * Description tuning (v1.7): propose better descriptions from the train failures, score every candidate
 * with the trigger eval, keep the best by held-out score. At most 3 iterations. Returns the proposal and the
 * scores — it never writes the skill file.
 */
import { runClaude } from "../claude-run.js";
import matter from "../matter.js";
import { parseSkill } from "../skill-schema.js";
import { DESCRIPTION_LIMIT, improveDescriptionPrompt, parseNewDescription, shortenPrompt, type DescriptionAttempt } from "./prompts/improve-description.js";
import type { EvalPrompt } from "./sets.js";
import { runTrigger, type TriggerReport } from "./trigger.js";

export const MAX_TUNE_ITERATIONS = 3;

export interface TuneCandidate {
  description: string;
  train: number | null;
  heldout: number | null;
}

export interface TuneReport {
  original: TuneCandidate;
  best: TuneCandidate;
  /** the best candidate is not the original */
  improved: boolean;
  candidates: TuneCandidate[];
}

/** The skill file with its frontmatter description replaced and nothing else changed. */
export function withDescription(raw: string, description: string): string {
  const p = matter(raw);
  return matter.stringify(p.content, { ...p.data, description });
}

const score = (r: TriggerReport): TuneCandidate["train"] => r.train.accuracy;
const frac = (r: TriggerReport) => `${r.results.filter((x) => x.split === "train" && x.triggered === x.should_trigger).length}/${r.train.n}`;

export async function tuneDescription(o: { repoRoot: string; skillRaw: string; prompts: EvalPrompt[]; env?: NodeJS.ProcessEnv; maxIterations?: number }): Promise<TuneReport> {
  const skill = parseSkill(o.skillRaw);
  const tr = (raw: string) => runTrigger(o.prompts, { repoRoot: o.repoRoot, skillRaw: raw, env: o.env });
  const cand = (description: string, r: TriggerReport): TuneCandidate => ({ description, train: score(r), heldout: r.heldout.accuracy });
  let last = await tr(o.skillRaw);
  const original = cand(skill.description, last);
  const candidates = [original];
  const history: DescriptionAttempt[] = [];
  for (let i = 0; i < Math.min(o.maxIterations ?? MAX_TUNE_ITERATIONS, MAX_TUNE_ITERATIONS); i++) {
    const prev = candidates.at(-1)!;
    history.push({ description: prev.description, score: frac(last) });
    // only train results go to the proposer; held-out stays unseen so it can judge
    const train = last.results.filter((r) => r.split === "train");
    const prompt = improveDescriptionPrompt({
      name: skill.name,
      skillContent: skill.body,
      description: prev.description,
      score: frac(last),
      missed: train.filter((r) => r.should_trigger && !r.triggered),
      falseTriggers: train.filter((r) => !r.should_trigger && r.triggered),
      history: history.slice(0, -1),
    });
    const env = o.env;
    let r = await runClaude({ prompt, cwd: o.repoRoot, tools: [], maxTurns: 1, env });
    if (!r.ok) break;
    let description = parseNewDescription(r.result);
    if (description.length > DESCRIPTION_LIMIT) {
      r = await runClaude({ prompt: shortenPrompt(prompt, description), cwd: o.repoRoot, tools: [], maxTurns: 1, env });
      if (r.ok) description = parseNewDescription(r.result);
    }
    if (!description || description.length > DESCRIPTION_LIMIT || candidates.some((c) => c.description === description)) continue;
    last = await tr(withDescription(o.skillRaw, description));
    candidates.push(cand(description, last));
  }
  // best by held-out, ties by train, then the earlier candidate (the original wins a full tie)
  const best = candidates.reduce((b, c) => ((c.heldout ?? -1) > (b.heldout ?? -1) || ((c.heldout ?? -1) === (b.heldout ?? -1) && (c.train ?? -1) > (b.train ?? -1)) ? c : b));
  return { original, best, improved: best !== original, candidates };
}


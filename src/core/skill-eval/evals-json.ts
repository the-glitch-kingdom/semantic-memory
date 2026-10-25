/**
 * Skill-creator's `evals/evals.json` (references/schemas.md), read and written as-is so evals made here
 * open in skill-creator and the other way round.
 */
export interface EvalCase {
  id: number;
  prompt: string;
  expected_output: string;
  /** input file paths, relative to the skill root */
  files?: string[];
  expectations: string[];
}

export interface EvalsFile {
  skill_name: string;
  evals: EvalCase[];
}

export function parseEvals(text: string): EvalsFile {
  const j = JSON.parse(text);
  if (typeof j?.skill_name !== "string" || !Array.isArray(j.evals)) throw new Error("evals.json needs skill_name and an evals array");
  const ids = new Set<number>();
  for (const e of j.evals) {
    if (!Number.isInteger(e?.id) || typeof e.prompt !== "string" || typeof e.expected_output !== "string" || !Array.isArray(e.expectations) || e.expectations.some((x: unknown) => typeof x !== "string"))
      throw new Error(`evals.json: bad eval ${JSON.stringify(e?.id)}: id (integer), prompt, expected_output and expectations (strings) are required`);
    if (e.files !== undefined && (!Array.isArray(e.files) || e.files.some((x: unknown) => typeof x !== "string"))) throw new Error(`evals.json: eval ${e.id}: files must be strings`);
    if (ids.has(e.id)) throw new Error(`evals.json: duplicate id ${e.id}`);
    ids.add(e.id);
  }
  return j as EvalsFile;
}

export const renderEvals = (f: EvalsFile): string => JSON.stringify(f, null, 2) + "\n";

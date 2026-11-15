// Operating targets (#96): the defaults, the file they live in, and what `eval init` writes next to the question sets.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Target { value: number | null; why: string }
export type Targets = Record<string, Target>;

export const TARGETS_FILE = "targets.json";

/** Order is the report's row order. Rates are 0..1; `p95_ms` is milliseconds. */
export const DEFAULT_TARGETS: Targets = {
  hybrid_at1: { value: 0.75, why: "below this an agent re-searches or guesses on a quarter of questions" },
  hybrid_at3: { value: 0.95, why: "the answer should be on the first screen almost always" },
  exact_at1: { value: 0.9, why: "keyword questions should be near-solved" },
  paraphrase_at1: { value: 0.75, why: "harder than keyword, but where users and agents actually live" },
  related_at1: { value: 0.85, why: "the top hit plus its linked neighbours should cover the answer" },
  verified_top3: { value: 0.8, why: "the returned docs should have been checked against the code" },
  no_missing_refs_top3: { value: 0.9, why: "the returned docs should not point at things that no longer exist" },
  negatives_flagged: { value: 0.85, why: "6 of 7, scaled: say \"no strong match\" when the answer is not in the docs" },
  false_flags: { value: 0.03, why: "at most 1 of 34, scaled: a false \"no match\" on an answerable question costs more than a missed abstention" },
  p95_ms: { value: 100, why: "interactive budget" },
};

/** Reads `<dir>/targets.json` over the defaults; a file that is not valid refuses (never a silent fallback). `null` means "shown, not judged". */
export function loadTargets(dir: string): { targets: Targets; unknown: string[] } {
  const file = join(dir, TARGETS_FILE);
  const bad = (why: string): never => { throw new Error(`${file}: ${why}`); };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf-8")); } catch (e: any) { return bad(e.message); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("expected an object of {metric: {value, why}}");
  const targets: Targets = { ...DEFAULT_TARGETS };
  const unknown: string[] = [];
  for (const [k, t] of Object.entries(raw as Record<string, any>)) {
    if (!(k in DEFAULT_TARGETS)) { unknown.push(k); continue; }
    if (!t || typeof t !== "object" || !(t.value === null || (typeof t.value === "number" && Number.isFinite(t.value)))) bad(`${k}.value must be a number or null`);
    targets[k] = { value: t.value, why: typeof t.why === "string" && t.why ? t.why : DEFAULT_TARGETS[k].why };
  }
  return { targets, unknown };
}

const TEMPLATE = JSON.stringify({
  id: "blind-001", q: "How do I rotate the signing key without downtime?", tier: "paraphrase",
  facets: ["rotat\\w+.*key", "overlap|both keys"], expected: ["ops/keys.md"], blind: true, written_from: "git log: the key-rotation change, not the docs",
}) + "\n";

const GUIDE = `# Writing a blind question set

A blind set is a set of questions the docs did not write. Targets are only validated against one:
the eval prints \`not validated\` until at least one case is marked \`"blind": true\`.

Copy \`questions.template.jsonl.example\` to a \`.jsonl\` file here (the template itself is never loaded).
One JSON object per line: \`id\`, \`q\`, \`tier\` (exact | paraphrase | multi | negative), \`facets\`
(regexes the answering text must match), optional \`expected\` doc paths, \`blind\`.

## Write the questions from outside the docs

Use the code, git history, issues and real queries people or agents typed. Never write them from the docs,
or from a doc-generated set (\`eval generate\` samples the docs, so it writes \`blind: false\`).

## Check for leakage

Agents that write "blind" questions have already read \`CLAUDE.md\`, \`AGENTS.md\` and \`.claude/rules/\`.
Grep each question's distinctive terms in those files and rewrite any that came from them.
On one real first draft, 16 of 35 questions did.

## A docs fix makes the set non-blind

Once you fix the docs a set's misses land on, that set has been used to tune the docs. Write a fresh
held-out set before such a pass, and flip the old one to \`"blind": false\`.

## Measure honestly

- Measure on a full cold index build, and record the corpus commit, plugin version and config.
- A change of 1/n (one question) is noise. Do not celebrate or revert on it.
`;

const INIT_FILES: Record<string, string> = {
  [TARGETS_FILE]: JSON.stringify(DEFAULT_TARGETS, null, 2) + "\n",
  "questions.template.jsonl.example": TEMPLATE,
  "BLIND-SETS.md": GUIDE,
};

/** Writes the missing files (all of them, or `only`); `force` rewrites existing ones. Returns what was written and what was left alone. */
export function writeDefaults(dir: string, { force = false, only }: { force?: boolean; only?: string[] } = {}): { written: string[]; kept: string[] } {
  mkdirSync(dir, { recursive: true });
  const out = { written: [] as string[], kept: [] as string[] };
  for (const [name, text] of Object.entries(INIT_FILES)) {
    if (only && !only.includes(name)) continue;
    const file = join(dir, name);
    if (existsSync(file) && !force) { out.kept.push(file); continue; }
    writeFileSync(file, text);
    out.written.push(file);
  }
  return out;
}

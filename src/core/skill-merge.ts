/**
 * Merging learned skills (v1.7) — opt-in only: `skill_loop_consolidate: true` in the repo config, or
 * `skill-loop curate --merge`. Candidate pairs come from word overlap of name, description, triggers and
 * applies_to. Jev mode: Jev judges each pair (same procedure / one contains the other, >= 0.95) and only a
 * yes goes on to Claude for the merged text; without jev mode Claude judges and drafts in one call. Either
 * way the result is a review draft that `supersedes` both — nothing merges without a person.
 */
import { featureOn, readRepoConfig } from "./features.js";
import { askJev, jevVerdict } from "./jev.js";
import { runClaude } from "./claude-run.js";
import { findSkills, type SkillFile } from "./skill-schema.js";
import { materializeDraft, parseReviewerJson } from "./skill-review.js";

export const MERGE_MIN_OVERLAP = 0.5;

const words = (s: SkillFile) =>
  new Set(
    [s.skill.name, s.skill.description, ...(s.skill.meta?.triggers ?? []), ...(s.skill.meta?.applies_to.paths ?? []), ...(s.skill.meta?.applies_to.commands ?? [])]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

export function mergeCandidates(repo: string, env = process.env): { a: SkillFile; b: SkillFile; overlap: number }[] {
  const learned = findSkills(repo, { home: env.HOME, global: false }).filter((s) => s.learned && s.skill.meta && !s.skill.meta.pinned);
  const out: { a: SkillFile; b: SkillFile; overlap: number }[] = [];
  for (let i = 0; i < learned.length; i++) {
    for (let j = i + 1; j < learned.length; j++) {
      const x = words(learned[i]), y = words(learned[j]);
      const shared = [...x].filter((w) => y.has(w)).length;
      const overlap = shared / (x.size + y.size - shared || 1);
      if (overlap >= MERGE_MIN_OVERLAP) out.push({ a: learned[i], b: learned[j], overlap });
    }
  }
  return out.sort((p, q) => q.overlap - p.overlap);
}

export const consolidateOn = (repo: string) => readRepoConfig(repo).skill_loop_consolidate === true;

const show = (s: SkillFile) => `### ${s.skill.name}\n${s.skill.description}\n\n${s.skill.body}`;

const MERGE_PROMPT = `Two learned skills of this repository may describe the same procedure. If they do (or one contains the
other), write ONE skill that keeps every step and pitfall that is still true, in the same format as the inputs:
sections "## When to use", "## Steps", "## Pitfalls", "## Verify". Never invent steps. If they are different
procedures, say so.

Answer with one JSON object and nothing else:
{"drafts": [{"kind": "new", "name": "<kebab-case>", "description": "<what + Use when ...>", "scope": "project",
  "applies_to": {"paths": [], "commands": []}, "triggers": [], "provenance": {"sessions": [], "failures": [], "corrections": []},
  "cites": [], "body": "..."}]}  — or {"drafts": [], "none_reason": "<why they are different>"}`;

export async function proposeMerges(repo: string, env = process.env): Promise<{ drafted: string[]; skipped: string[] }> {
  const drafted: string[] = [];
  const skipped: string[] = [];
  const jev = featureOn("jev", repo, env);
  const used = new Set<string>();
  for (const { a, b } of mergeCandidates(repo, env)) {
    if (used.has(a.path) || used.has(b.path)) continue;
    const pair = `${a.skill.name} + ${b.skill.name}`;
    if (jev) {
      const r = await askJev(
        {
          cwd: repo,
          caller: "semantic-memory-skill-loop",
          state: `${show(a)}\n\n${show(b)}`.slice(0, 2000),
          questions: [
            { key: "same", instructions: "Do these two skills describe the same procedure, so that one could replace the other?" },
            { key: "subset", instructions: "Is every step of one of these skills already contained in the other skill?" },
          ],
        },
        { env, timeoutMs: 30_000 },
      );
      if (jevVerdict(r.scores.same) !== true && jevVerdict(r.scores.subset) !== true) {
        skipped.push(`${pair}: Jev did not say duplicate (${r.error ?? JSON.stringify(r.scores)})`);
        continue;
      }
    }
    const run = await runClaude({ prompt: `${MERGE_PROMPT}\n\n---\n\n${show(a)}\n\n${show(b)}`, cwd: repo, tools: [], maxTurns: 1, env });
    const answer = run.ok ? parseReviewerJson(run.result) : null;
    const d = answer?.drafts[0];
    if (!d) {
      skipped.push(`${pair}: ${answer?.none_reason ?? run.error ?? "no merge proposed"}`);
      continue;
    }
    const prov = (k: "sessions" | "failures" | "corrections") => [...new Set([...(a.skill.meta!.provenance[k] ?? []), ...(b.skill.meta!.provenance[k] ?? [])])];
    const job = { session_id: prov("sessions")[0] ?? "merge", repo, transcript_path: null, reason: `merge of ${pair}`, ts: new Date().toISOString(), evidence: { failures: prov("failures"), corrections: prov("corrections").length, skills_used: [], tool_calls: 0 } };
    const r = await materializeDraft(
      repo,
      job,
      { ...d, kind: "new", provenance: { sessions: prov("sessions"), failures: prov("failures"), corrections: prov("corrections") } },
      findSkills(repo, { home: env.HOME }).filter((s) => s.path !== a.path && s.path !== b.path),
      async () => ({ scope: "project", globalCandidate: false, why: `merge of ${pair}` }),
      env,
      { supersedes: [a.path, b.path] },
    );
    if (r.id) {
      drafted.push(r.id);
      used.add(a.path).add(b.path);
    } else skipped.push(`${pair}: ${r.rejected}`);
  }
  return { drafted, skipped };
}

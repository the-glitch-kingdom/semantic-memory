/**
 * Trigger eval sets (v1.7): positives are prompts from the skill's own provenance sessions, near-miss
 * negatives are prompts from other sessions that share terms with it. The caller supplies the prompts
 * (this module reads no transcripts). Split ~60/40 into train / held-out by hashing the prompt text.
 */
import { createHash } from "node:crypto";
import type { ParsedSkill } from "../skill-schema.js";

export interface CandidatePrompt {
  session: string;
  text: string;
}

export interface EvalPrompt {
  text: string;
  should_trigger: boolean;
  split: "train" | "heldout";
}

const STOP = new Set(["the", "and", "for", "with", "when", "this", "that", "use", "run", "you", "are", "not", "can", "how", "what", "from", "into", "your"]);
const terms = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));

/** Same prompt, same side of the split, on every machine. */
export const splitOf = (text: string): EvalPrompt["split"] => (createHash("sha256").update(text).digest().readUInt32BE(0) % 100 < 60 ? "train" : "heldout");

export function buildEvalSet(skill: ParsedSkill, candidates: CandidatePrompt[], opts: { maxNegatives?: number } = {}): EvalPrompt[] {
  const sessions = new Set(skill.meta?.provenance.sessions ?? []);
  const own = terms([skill.name, skill.description, ...(skill.meta?.triggers ?? [])].join(" "));
  const seen = new Set<string>();
  const positives: string[] = [];
  const near: { text: string; overlap: number }[] = [];
  for (const c of candidates) {
    const text = c.text.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (sessions.has(c.session)) positives.push(text);
    else {
      const overlap = [...terms(text)].filter((t) => own.has(t)).length;
      if (overlap > 0) near.push({ text, overlap });
    }
  }
  near.sort((a, b) => b.overlap - a.overlap || a.text.localeCompare(b.text));
  const negatives = near.slice(0, opts.maxNegatives ?? Math.max(positives.length, 4)).map((n) => n.text);
  return [...positives.map((text) => ({ text, should_trigger: true })), ...negatives.map((text) => ({ text, should_trigger: false }))].map((p) => ({ ...p, split: splitOf(p.text) }));
}

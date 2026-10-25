/**
 * The skill loop's evidence (v1.7): what the between-session review learns from. Hooks append one line
 * per event when the skill loop is on; nothing here decides anything.
 *
 *   .claude/.semantic-memory/skill-usage.jsonl   {ts, session_id, skill, via: "tool" | "slash"}
 *   .claude/.semantic-memory/failures.jsonl      {ts, session_id, id, tool, command, error}
 *   .claude/.semantic-memory/corrections.jsonl   {ts, session_id, cue, excerpt}
 *
 * The free-text fields (command, error, excerpt) are redacted (broad: these are logs) before anything is
 * written — ids and names are left alone so records still join up. Each record is capped in size, and each file is
 * rotated to `<file>.1` past SEMANTIC_MEMORY_SKILL_LOOP_EVIDENCE_MB (default 5). Standalone for hooks.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "./redact.js";

export type EvidenceKind = "usage" | "failures" | "corrections";
const FILES: Record<EvidenceKind, string> = { usage: "skill-usage.jsonl", failures: "failures.jsonl", corrections: "corrections.jsonl" };

export const stateDir = (repoRoot: string) => join(repoRoot, ".claude", ".semantic-memory");
export const evidencePath = (repoRoot: string, kind: EvidenceKind) => join(stateDir(repoRoot), FILES[kind]);

/** The repo a hook's cwd belongs to: the nearest ancestor holding .git, else the cwd itself. */
export function repoRoot(cwd: string): string {
  for (let d = cwd; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return cwd;
  }
}

// broad redaction would also mask session and tool-use ids (long mixed tokens): only free text is redacted
const TEXT_FIELDS = ["command", "error", "excerpt", "prompt"];
const maxBytes = (env = process.env) => (Number(env.SEMANTIC_MEMORY_SKILL_LOOP_EVIDENCE_MB) || 5) * 1024 * 1024;

export function appendEvidence(root: string, kind: EvidenceKind, record: Record<string, unknown>, env = process.env): void {
  const path = evidencePath(root, kind);
  mkdirSync(dirname(path), { recursive: true });
  try {
    if (statSync(path).size > maxBytes(env)) renameSync(path, `${path}.1`);
  } catch {}
  const out: Record<string, unknown> = { ts: new Date().toISOString(), ...record };
  for (const k of TEXT_FIELDS) if (typeof out[k] === "string") out[k] = redact(out[k] as string, "broad").text;
  appendFileSync(path, JSON.stringify(out) + "\n");
}

export function readEvidence<T = Record<string, any>>(root: string, kind: EvidenceKind): T[] {
  const out: T[] = [];
  for (const p of [`${evidencePath(root, kind)}.1`, evidencePath(root, kind)]) {
    let raw = "";
    try {
      raw = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {}
    }
  }
  return out;
}

const cap = (s: unknown, n: number) => String(s ?? "").slice(0, n);

export const failureRecord = (input: { session_id?: string; tool_use_id?: string; tool_name?: string; tool_input?: any; error?: string }) => ({
  session_id: input.session_id ?? null,
  id: input.tool_use_id ?? null,
  tool: input.tool_name ?? null,
  command: cap(typeof input.tool_input?.command === "string" ? input.tool_input.command : JSON.stringify(input.tool_input ?? {}), 500),
  error: cap(input.error, 1000),
});

// A correction: the user telling the agent it got something wrong. Only these cues, so ordinary
// prompts ("I don't know why…", "no rush") do not count.
const CORRECTION_CUES: [string, RegExp][] = [
  ["no", /^\s*(no|nope|nah)\s*([,.!:;]|-|$)/i],
  ["wrong", /^\s*(wrong|incorrect)\b|\bthat'?s (wrong|not right|incorrect|not what)\b/i],
  ["not-what-i", /\bnot what i (asked|meant|wanted|said)\b/i],
  ["instead", /\b(use|do|run|try|call)\b[^.?!]{0,40}\binstead\b|^\s*instead\b/i],
  ["dont", /^\s*don'?t\b|\bdon'?t (do|use|run|touch|change|add|delete|remove|edit|call|push|commit)\b/i],
  ["you-broke", /\byou (broke|forgot|missed|skipped|ignored)\b/i],
  ["stop", /^\s*stop\b/i],
];

/** Fenced code, inline code and quoted lines are machinery, not the user talking. */
const stripQuoted = (p: string) => p.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/^>.*$/gm, " ");

export function detectCorrection(prompt: string): string | null {
  const text = stripQuoted(prompt);
  for (const [cue, re] of CORRECTION_CUES) if (re.test(text)) return cue;
  return null;
}

/** `/name …` typed by the user: Claude Code runs the skill without a Skill tool call, so PostToolUse never sees it. */
export function slashSkill(prompt: string): string | null {
  const m = prompt.match(/^\s*\/([a-z0-9][a-z0-9-]*)(\s|$)/);
  return m ? m[1] : null;
}

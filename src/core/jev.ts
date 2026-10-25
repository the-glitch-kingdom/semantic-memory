/**
 * Ask Jev yes/no questions through hooks/jev-bridge.py → jev-loop's `router.ask` (v1.7 jev mode).
 * The bridge redacts (jev-loop's redact.py), caches, keeps the ledger and enforces budgets; this side
 * only spawns it, with a hard timeout. Every failure is `{scores: {}, error}` — callers treat a missing
 * score as "no" (the safe default), never as permission.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type JevCaller = "semantic-memory-hook" | "semantic-memory-judge" | "semantic-memory-skill-loop";

export interface JevQuestion {
  key: string;
  instructions: string;
}

export interface JevAnswer {
  scores: Record<string, number>;
  tokens?: number;
  error?: string;
  /** The live caller's daily ceiling was reached: nothing was sent. */
  ceiling?: boolean;
}

/** jev-loop's bar: act on a yes only at or above it, on a no only at or below 1 - it. */
export const JEV_BAR = 0.95;

// src/core/jev.ts sits two levels below the package root; built, this code can land in a shared dist/ chunk one level below
export const BRIDGE =
  ["../../hooks/jev-bridge.py", "../hooks/jev-bridge.py"].map((p) => fileURLToPath(new URL(p, import.meta.url))).find((p) => existsSync(p)) ??
  fileURLToPath(new URL("../../hooks/jev-bridge.py", import.meta.url));

export function askJev(
  input: { cwd: string; caller: JevCaller; state: string; questions: JevQuestion[] },
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; bridge?: string } = {},
): Promise<JevAnswer> {
  const bridge = opts.bridge ?? BRIDGE;
  if (!existsSync(bridge)) return Promise.resolve({ scores: {}, error: `bridge missing at ${bridge}` });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((done) => {
    let settled = false;
    const finish = (a: JevAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(a);
    };
    const child = spawn("python3", [bridge], { env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ scores: {}, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("error", (e) => finish({ scores: {}, error: `bridge failed to start: ${e.message}` }));
    child.on("close", () => {
      try {
        const line = stdout.trim().split("\n").pop() || "{}";
        const a = JSON.parse(line) as JevAnswer;
        finish({ ...a, scores: a.scores && typeof a.scores === "object" ? a.scores : {} });
      } catch {
        finish({ scores: {}, error: "bridge gave no JSON" });
      }
    });
    child.stdin.on("error", () => {});
    // live: the HTTP call must end inside the hook's budget (python start-up and import take ~150 ms)
    const live = input.caller === "semantic-memory-hook" ? { timeout_seconds: Math.max(0.2, (timeoutMs - 250) / 1000) } : {};
    child.stdin.end(JSON.stringify({ ...input, ...live }));
  });
}

/** Tokens each semantic-memory caller spent with Jev today, from jev-loop's usage ledger (numbers only). */
export function jevSpendToday(jevDir: string, now = new Date()): Record<string, number> {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const out: Record<string, number> = {};
  const logs = join(jevDir, "logs");
  let files: string[] = [];
  try {
    files = readdirSync(logs).filter((f) => f.startsWith("jev-usage-") && f.endsWith(".jsonl"));
  } catch {
    return out;
  }
  for (const f of files) {
    for (const line of readFileSync(join(logs, f), "utf8").split("\n")) {
      try {
        const r = JSON.parse(line);
        if (String(r.caller).startsWith("semantic-memory-") && String(r.time).startsWith(day)) {
          out[r.caller] = (out[r.caller] ?? 0) + (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
        }
      } catch {}
    }
  }
  return out;
}

/** A Jev probability as a verdict: yes at or above the bar, no at or below 1 − bar, otherwise unsure (null). */
export const jevVerdict = (p: number | undefined, bar = JEV_BAR): boolean | null =>
  p === undefined ? null : p >= bar ? true : p <= 1 - bar + 1e-9 ? false : null;

/** The failure → document relevance question (judge, gate and the failure hook ask the same thing). */
export const relevanceQuestion = (title: string, excerpt: string) =>
  `Does this document explain the cause of this failure, or how to fix or avoid it — the same specific problem, ` +
  `not just the same tool or topic? Document: ${title} — ${excerpt.replace(/\s+/g, " ").trim().slice(0, 600)}`;

/** The state Jev sees for a failed tool call: the command and its error, capped. */
export const failureState = (command: string, error: string) => `Command: ${command}\nError: ${error}`.slice(0, 2000);

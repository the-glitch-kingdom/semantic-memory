/**
 * Every `claude` process the skill loop starts goes through here (v1.7): the reviewer, eval runs, graders,
 * description tuning. Two guarantees:
 *
 *  - **At most 5 at once, machine-wide.** A slot file under ~/.semantic-memory/claude-slots/ is held for the
 *    life of each run (SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY, 1–5, higher clamps to 5). A slot whose
 *    holder died is reclaimed.
 *  - **Fenced.** No hooks, no MCP servers (claude.ai connectors included), no user settings, only the tools
 *    asked for, never Agent/Task (no nested subagents), nothing outside the working directory (dontAsk),
 *    no session file, and SEMANTIC_MEMORY_REVIEWER=1 so any semantic-memory hook that still runs exits at once.
 *    Verified flag by flag on Claude Code 2.1.310 (.planning/v17-skill-loop-and-jev-mode/notes.md, Phase 2).
 */
import { spawn } from "node:child_process";
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_CLAUDE = 5;

export function claudeConcurrency(env = process.env): number {
  const n = Number(env.SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_CLAUDE, Math.floor(n)) : MAX_CLAUDE;
}

export const slotsDir = (env = process.env) =>
  env.SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR || join(env.HOME || homedir(), ".semantic-memory", "claude-slots");

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Take one of the machine-wide slots, waiting for one to free up. Resolves to its release function. */
export async function acquireSlot(opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number; pollMs?: number } = {}): Promise<() => void> {
  const env = opts.env ?? process.env;
  const dir = slotsDir(env);
  const max = claudeConcurrency(env);
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
  mkdirSync(dir, { recursive: true });
  for (;;) {
    for (let i = 0; i < max; i++) {
      const path = join(dir, `slot-${i}`);
      try {
        const fd = openSync(path, "wx");
        writeSync(fd, `${process.pid}\n`);
        closeSync(fd);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try {
            unlinkSync(path);
          } catch {}
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        // held: reclaim it when its holder is gone (crashed worker, killed run)
        try {
          const pid = Number(readFileSync(path, "utf8").trim());
          if (!pid || !alive(pid)) unlinkSync(path);
        } catch {}
      }
    }
    if (Date.now() > deadline) throw new Error(`no claude slot free after ${opts.timeoutMs ?? 1_800_000} ms (${max} in use)`);
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 250));
  }
}

export interface ClaudeRunOptions {
  prompt: string;
  cwd: string;
  /** built-in tools the run may use; [] = none */
  tools: string[];
  maxTurns: number;
  model?: string;
  /** "json": one result object; "stream-json": every event (to see which tools were called) */
  output?: "json" | "stream-json";
  timeoutMs?: number;
  /** extra directories the run may read */
  addDirs?: string[];
  appendSystemPrompt?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ClaudeRunResult {
  ok: boolean;
  /** final assistant text */
  result: string;
  /** stream-json events (empty for json output) */
  events: any[];
  costUsd: number;
  turns: number;
  error?: string;
}

export const claudeBin = (env = process.env) => env.SEMANTIC_MEMORY_CLAUDE_BIN || "claude";
export const skillLoopModel = (env = process.env) => env.SEMANTIC_MEMORY_SKILL_LOOP_MODEL || "sonnet";

/** The fenced argument list (exported for tests: these flags are the security boundary). */
export function fencedArgs(o: Pick<ClaudeRunOptions, "tools" | "maxTurns" | "model" | "output" | "addDirs" | "appendSystemPrompt">, env = process.env): string[] {
  const args = [
    "-p",
    "--tools", o.tools.join(","),
    "--disallowedTools", "Task,Agent",
    "--strict-mcp-config",
    "--settings", JSON.stringify({ disableAllHooks: true }),
    "--setting-sources", "project,local",
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
    "--max-turns", String(o.maxTurns),
    "--model", o.model ?? skillLoopModel(env),
    "--output-format", o.output ?? "json",
  ];
  if ((o.output ?? "json") === "stream-json") args.push("--verbose");
  for (const d of o.addDirs ?? []) args.push("--add-dir", d);
  if (o.appendSystemPrompt) args.push("--append-system-prompt", o.appendSystemPrompt);
  return args;
}

/** Run one fenced `claude -p` inside a slot. Never throws: failures come back as `ok: false` with the reason. */
export async function runClaude(o: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const env = { ...(o.env ?? process.env), SEMANTIC_MEMORY_REVIEWER: "1" };
  const fail = (error: string): ClaudeRunResult => ({ ok: false, result: "", events: [], costUsd: 0, turns: 0, error });
  let release: () => void;
  try {
    release = await acquireSlot({ env });
  } catch (e) {
    return fail((e as Error).message);
  }
  try {
    return await new Promise<ClaudeRunResult>((done) => {
      const child = spawn(claudeBin(env), fencedArgs(o, env), { cwd: o.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        done(fail(`timed out after ${o.timeoutMs ?? 600_000} ms`));
      }, o.timeoutMs ?? 600_000);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        done(fail(`could not start ${claudeBin(env)}: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(parseClaudeOutput(stdout, o.output ?? "json", code, stderr));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(o.prompt);
    });
  } finally {
    release();
  }
}

export function parseClaudeOutput(stdout: string, output: "json" | "stream-json", code: number | null, stderr = ""): ClaudeRunResult {
  const events: any[] = [];
  let final: any = null;
  if (output === "json") {
    try {
      final = JSON.parse(stdout.trim());
    } catch {}
  } else {
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        events.push(e);
        if (e.type === "result") final = e;
      } catch {}
    }
  }
  if (!final) return { ok: false, result: "", events, costUsd: 0, turns: 0, error: `no result from claude (exit ${code}): ${stderr.trim().slice(0, 300)}` };
  return {
    ok: !final.is_error && final.subtype !== "error_during_execution",
    result: typeof final.result === "string" ? final.result : "",
    events,
    costUsd: Number(final.total_cost_usd) || 0,
    turns: Number(final.num_turns) || 0,
    error: final.is_error ? String(final.result ?? final.subtype ?? "error") : final.subtype === "error_max_turns" ? "max turns reached" : undefined,
  };
}

/** Names of the skills a stream-json run invoked through the Skill tool, in order. */
export const skillsCalled = (events: any[]): string[] =>
  events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []))
    .filter((c: any) => c.type === "tool_use" && c.name === "Skill" && typeof c.input?.skill === "string")
    .map((c: any) => c.input.skill);

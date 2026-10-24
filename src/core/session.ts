import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { redact } from "./redact.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface VerificationRecord {
  cmd: string;
  exit: number | null;
  signal: string | null;
  duration_ms: number;
  tail: string;
  at: string;
}

export interface SessionState {
  id: string;
  task: string;
  started_at: string;
  last_activity_at: string;
  verifications: VerificationRecord[];
  notes_touched: string[];
  closed_at?: string;
  closed_summary?: string;
  closed_verified_waived?: boolean;
  closed_waiver_reason?: string;
}

export type SessionStatus =
  | { state: "no_session" }
  | (SessionState & { state: "active" | "stale" });

export interface SessionStartOptions {
  /** When true and a session for the same task is already open, return the existing id rather than failing. Defaults to true. */
  reuseSameTask?: boolean;
}

export interface SessionFinishInput {
  summary: string;
  /**
   * When false, the caller is explicitly waiving verification (e.g. for doc-only edits).
   * Requires a non-empty `reason`. When true (default) and no verifications have been
   * recorded, the call is refused.
   */
  verified?: boolean;
  reason?: string;
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TAIL_BYTES = 4096;

/**
 * SessionManager owns a single session.json file at `<sessionDir>/session.json`.
 *
 * State is durable across MCP server restarts (the file persists). At most one session
 * is active per project at a time — concurrent sessions are explicitly out of scope
 * for v1.1; brain has the same constraint.
 *
 * Hard gates:
 *  - session_finish refuses without verifications unless verified=false + reason
 *  - session_run refuses without an open session
 *  - session_start refuses if another session is open with a different task
 *
 * Stale detection: a session whose last_activity_at is >24h old is reported as
 * state:"stale" by status(). Stale sessions can still be finished or extended; the
 * label is informational so callers can decide whether to abandon (rm + start new) or
 * resume.
 */
export class SessionManager {
  constructor(private sessionDir: string) {}

  get sessionPath(): string {
    return join(this.sessionDir, "session.json");
  }

  async start(task: string, opts: SessionStartOptions = {}): Promise<{ ok: true; id: string; reused?: boolean } | { ok: false; error: string }> {
    if (!task || task.trim().length === 0) {
      return { ok: false, error: "session_start requires a non-empty task." };
    }
    await mkdir(this.sessionDir, { recursive: true });
    const existing = await this.read();
    if (existing && !existing.closed_at) {
      const reuseSameTask = opts.reuseSameTask !== false;
      if (reuseSameTask && existing.task === task) {
        return { ok: true, id: existing.id, reused: true };
      }
      return {
        ok: false,
        error: `Session already open: id=${existing.id}, task=${JSON.stringify(existing.task)}. Close it with session_finish first.`,
      };
    }
    const now = new Date().toISOString();
    const id = `ses_${now.replace(/[:.]/g, "-")}`;
    const state: SessionState = {
      id,
      task: redact(task.trim(), "broad").text,
      started_at: now,
      last_activity_at: now,
      verifications: [],
      notes_touched: [],
    };
    await writeFile(this.sessionPath, JSON.stringify(state, null, 2), "utf-8");
    return { ok: true, id };
  }

  async status(): Promise<SessionStatus> {
    const state = await this.read();
    if (!state || state.closed_at) return { state: "no_session" };
    const age = Date.now() - new Date(state.last_activity_at).getTime();
    const label: "active" | "stale" = age > STALE_THRESHOLD_MS ? "stale" : "active";
    return { ...state, state: label };
  }

  async run(cmd: string, timeoutMs?: number): Promise<{ ok: true; record: VerificationRecord } | { ok: false; error: string }> {
    const state = await this.read();
    if (!state || state.closed_at) {
      return { ok: false, error: "No active session. Run session_start first." };
    }
    if (!cmd || cmd.trim().length === 0) {
      return { ok: false, error: "session_run requires a non-empty command." };
    }
    const start = Date.now();
    const raw = await this.spawnAndCapture(cmd, timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // session.json keeps the command and its output tail: either can carry a token
    const record = { ...raw, cmd: redact(raw.cmd, "broad").text, tail: redact(raw.tail, "broad").text };
    record.duration_ms = Date.now() - start;
    state.verifications.push(record);
    state.last_activity_at = new Date().toISOString();
    await writeFile(this.sessionPath, JSON.stringify(state, null, 2), "utf-8");
    return { ok: true, record };
  }

  async finish(input: SessionFinishInput): Promise<{ ok: true; closed: SessionState } | { ok: false; error: string }> {
    const state = await this.read();
    if (!state || state.closed_at) {
      return { ok: false, error: "No active session to finish." };
    }
    const explicitWaiver = input.verified === false;
    if (!explicitWaiver && state.verifications.length === 0) {
      return {
        ok: false,
        error:
          "session_finish refused: no verification commands recorded. Run session_run with a real verification command (tests, lint, etc.) first, OR pass verified=false with a reason to waive verification (e.g. for doc-only edits).",
      };
    }
    if (explicitWaiver && (!input.reason || input.reason.trim().length === 0)) {
      return {
        ok: false,
        error: "session_finish refused: verified=false requires a non-empty `reason` explaining why verification is not applicable to this task.",
      };
    }
    if (!input.summary || input.summary.trim().length === 0) {
      return { ok: false, error: "session_finish requires a non-empty `summary`." };
    }
    const closed: SessionState = {
      ...state,
      closed_at: new Date().toISOString(),
      closed_summary: input.summary.trim(),
      ...(explicitWaiver && {
        closed_verified_waived: true,
        closed_waiver_reason: input.reason!.trim(),
      }),
    };
    // Sessions are ephemeral runtime state — finished sessions are removed from disk.
    // Durable artifacts (synthesize_note proposals, log entries) capture what mattered.
    await rm(this.sessionPath, { force: true });
    return { ok: true, closed };
  }

  /**
   * Append paths to notes_touched on the active session, deduplicating. No-op when no
   * session is active. Used by patch tools to record what the session edited.
   */
  async recordNotesTouched(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const state = await this.read();
    if (!state || state.closed_at) return;
    const set = new Set(state.notes_touched);
    for (const p of paths) set.add(p);
    state.notes_touched = Array.from(set);
    state.last_activity_at = new Date().toISOString();
    await writeFile(this.sessionPath, JSON.stringify(state, null, 2), "utf-8");
  }

  /**
   * Read the active session WITHOUT computing the stale label. Returns null when no
   * session is active or when the file is unparseable.
   */
  async readActive(): Promise<SessionState | null> {
    const state = await this.read();
    if (!state || state.closed_at) return null;
    return state;
  }

  private async read(): Promise<SessionState | null> {
    if (!existsSync(this.sessionPath)) return null;
    try {
      const raw = await readFile(this.sessionPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed?.id !== "string") return null;
      return parsed as SessionState;
    } catch {
      return null;
    }
  }

  private spawnAndCapture(cmd: string, timeoutMs: number): Promise<VerificationRecord> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, { shell: true });
      let buf = "";
      let killedByTimeout = false;
      const timer = setTimeout(() => {
        killedByTimeout = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* already gone */ }
        }, 1000).unref();
      }, timeoutMs);

      const onData = (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        if (buf.length > TAIL_BYTES * 4) {
          buf = buf.slice(buf.length - TAIL_BYTES * 2);
        }
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);

      proc.on("close", (code, signal) => {
        clearTimeout(timer);
        const tail = buf.slice(-TAIL_BYTES);
        resolve({
          cmd,
          exit: killedByTimeout ? null : code,
          signal: killedByTimeout ? "SIGTERM (timeout)" : (signal ?? null),
          duration_ms: 0,
          tail,
          at: new Date().toISOString(),
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        const tail = buf + `\n[spawn error: ${err.message}]`;
        resolve({
          cmd,
          exit: null,
          signal: null,
          duration_ms: 0,
          tail: tail.slice(-TAIL_BYTES),
          at: new Date().toISOString(),
        });
      });
    });
  }
}

/**
 * Heuristic: derive the project root from the vault path. If the vault path ends in
 * `.claude/.vault`, the project root is two levels up. Otherwise the vault path is
 * treated as the project root.
 */
export function deriveProjectRoot(notesPath: string): string {
  const norm = notesPath.replace(/[\\/]+$/, "");
  if (norm.endsWith("/.claude/.vault") || norm.endsWith("\\.claude\\.vault")) {
    return norm.slice(0, -".claude/.vault".length).replace(/[\\/]+$/, "");
  }
  return norm;
}

export function deriveSessionDir(notesPath: string): string {
  return join(deriveProjectRoot(notesPath), ".claude", ".semantic-memory");
}

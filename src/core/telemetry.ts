import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact.js";
import { parse as parseYaml } from "yaml";
import { deriveSessionDir } from "./session.js";

/**
 * Selection-logging telemetry (v1.3.1).
 *
 * Records what retrieval actually returned and which note the answer used, so a
 * later release (v1.4 usage-feedback ranking) can learn which knowledge is
 * load-bearing. Strictly local, append-only JSONL, fire-and-forget, opt-out.
 *
 * NO NETWORK: this module performs local filesystem I/O only, and never opens a
 * socket or issues a remote request — a unit test greps this file to keep it that way.
 */

const LOG_FILE = "selection.jsonl";
const CORRELATION_WINDOW_MS = 60_000;

export interface SearchEvent {
  kind: "search";
  tool: string;
  query: string;
  results: { path: string; score: number; decay?: number }[];
}

export interface SelectionEvent {
  kind: "selection";
  note_path: string;
  via: string;
  /** True when this selection followed a recent search that returned this path. */
  correlated?: boolean;
}

export type TelemetryEvent = (SearchEvent | SelectionEvent) & { ts?: string };

/** Absolute path to the selection log for a given vault. */
export function selectionLogPath(vaultPath: string): string {
  return join(deriveSessionDir(vaultPath), LOG_FILE);
}

/**
 * Whether telemetry is enabled. Reads `telemetry.enabled` from vault.schema.yml;
 * defaults true (opt-out, not opt-in). Fails open to enabled only if the schema
 * is unreadable — a missing `telemetry` block means "use the default (true)".
 */
export function telemetryEnabled(vaultPath: string): boolean {
  try {
    const schemaPath = join(vaultPath, "vault.schema.yml");
    if (!existsSync(schemaPath)) return true;
    const parsed = parseYaml(readFileSync(schemaPath, "utf-8")) as { telemetry?: { enabled?: boolean } } | null;
    const e = parsed?.telemetry?.enabled;
    return typeof e === "boolean" ? e : true;
  } catch {
    return true;
  }
}

/**
 * Append one event. Fire-and-forget: respects the opt-out and NEVER throws — a
 * telemetry failure must not affect the tool call that triggered it.
 */
export async function appendEvent(vaultPath: string, event: TelemetryEvent, nowIso?: string): Promise<void> {
  try {
    if (!telemetryEnabled(vaultPath)) return;
    const dir = deriveSessionDir(vaultPath);
    await mkdir(dir, { recursive: true });
    // only the free-text query: note_path feeds usage-boost citation counts and must stay intact
    const safe = event.kind === "search" ? { ...event, query: redact(event.query, "broad").text } : event;
    const line = JSON.stringify({ ts: nowIso ?? new Date().toISOString(), ...safe });
    await appendFile(selectionLogPath(vaultPath), line + "\n", "utf-8");
  } catch {
    // fire-and-forget
  }
}

// --- In-process correlation ring ---
// Remembers the most recent search's top-k paths per vault so a subsequent
// read/synthesize can be attributed to it (best-effort, time-bounded).

const recentSearch = new Map<string, { paths: Set<string>; atMs: number }>();

export function recordSearchForCorrelation(vaultPath: string, paths: string[], nowMs?: number): void {
  recentSearch.set(vaultPath, { paths: new Set(paths), atMs: nowMs ?? Date.now() });
}

export function wasRecentlySearched(vaultPath: string, notePath: string, nowMs?: number): boolean {
  const r = recentSearch.get(vaultPath);
  if (!r) return false;
  if ((nowMs ?? Date.now()) - r.atMs > CORRELATION_WINDOW_MS) return false;
  return r.paths.has(notePath);
}

/** Read the selection log (oldest→newest). Returns [] if absent/unreadable. */
export async function readSelectionLog(vaultPath: string, opts: { limit?: number } = {}): Promise<TelemetryEvent[]> {
  try {
    const p = selectionLogPath(vaultPath);
    if (!existsSync(p)) return [];
    const raw = await readFile(p, "utf-8");
    const events = raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l) as TelemetryEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is TelemetryEvent => e !== null);
    return opts.limit ? events.slice(-opts.limit) : events;
  } catch {
    return [];
  }
}

/** For CLI/analysis: cited-vs-retrieved rollup over the log. */
export interface SelectionStats {
  searches: number;
  selections: number;
  citedPaths: Record<string, number>;
  retrievedNeverCited: string[];
}

export async function computeSelectionStats(vaultPath: string): Promise<SelectionStats> {
  const events = await readSelectionLog(vaultPath);
  const citedPaths: Record<string, number> = {};
  const retrieved = new Set<string>();
  let searches = 0;
  let selections = 0;
  for (const e of events) {
    if (e.kind === "search") {
      searches++;
      for (const r of e.results) retrieved.add(r.path);
    } else if (e.kind === "selection") {
      selections++;
      citedPaths[e.note_path] = (citedPaths[e.note_path] ?? 0) + 1;
    }
  }
  const retrievedNeverCited = [...retrieved].filter((p) => !(p in citedPaths)).sort();
  return { searches, selections, citedPaths, retrievedNeverCited };
}

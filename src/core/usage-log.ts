/**
 * The usage log (v1.15): what agents did after a docs search, recorded by the PostToolUse hook.
 *
 *   .claude/.semantic-memory/usage.jsonl   one per project, every line has "v":1
 *   search   {ts, session, id, server, tool, query, results[<=20 vault-relative paths], weak?}
 *   use      {ts, session, search, server, path, rank|null, via}
 *   fallback {ts, session, search, via, scope: "vault" | "repo"}
 *
 * Only these fields are written (never file contents, tool responses or grep patterns), the query is
 * redacted (broad) first, and nothing is written when the redactor cannot run. This is NOT the server's
 * selection log: no `selection` event is ever written here, so `usage_boost` (which counts them) and
 * ranking are untouched. Standalone for hooks; no reference to any other plugin.
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tokenize } from "./bm25.js";
import { redact, REDACTED } from "./redact.js";

export interface SearchEvent { v: 1; type: "search"; ts: string; session: string; id: string; server: string; tool: string; query: string; results: string[]; weak?: boolean }
export interface UseEvent { v: 1; type: "use"; ts: string; session: string; search: string; server: string; path: string; rank: number | null; via: string }
export interface FallbackEvent { v: 1; type: "fallback"; ts: string; session: string; search: string; via: string; scope: "vault" | "repo" }
export type UsageEvent = SearchEvent | UseEvent | FallbackEvent;

export const WINDOW_MS = 10 * 60 * 1000;
const MAX_RESULTS = 20;
const maxBytes = (env = process.env) => (Number(env.SEMANTIC_MEMORY_USAGE_LOG_MB) || 5) * 1024 * 1024;

export const usagePath = (repoRoot: string) => join(repoRoot, ".claude", ".semantic-memory", "usage.jsonl");

const KEEP: Record<string, string[]> = {
  search: ["ts", "session", "id", "server", "tool", "query", "results", "weak"],
  use: ["ts", "session", "search", "server", "path", "rank", "via"],
  fallback: ["ts", "session", "search", "via", "scope"],
};

/** Append one event (whitelisted fields only). Returns false, writing nothing, for an unknown type or when redaction fails. */
export function appendUsage(repoRoot: string, event: { type: string; [k: string]: unknown }, env = process.env): boolean {
  const keep = KEEP[event.type];
  if (!keep) return false;
  const out: Record<string, unknown> = { v: 1, type: event.type, ts: new Date().toISOString() };
  for (const k of keep) if (event[k] !== undefined) out[k] = event[k];
  if (event.type === "search") {
    out.results = (Array.isArray(out.results) ? out.results : []).filter((p) => typeof p === "string").slice(0, MAX_RESULTS);
    try {
      out.query = redact(String(out.query ?? ""), "broad").text;
    } catch {
      return false;
    }
  }
  const path = usagePath(repoRoot);
  try {
    mkdirSync(dirname(path), { recursive: true });
    try {
      if (statSync(path).size > maxBytes(env)) renameSync(path, `${path}.1`);
    } catch {}
    appendFileSync(path, JSON.stringify(out) + "\n");
    return true;
  } catch {
    return false;
  }
}

function parseLines(raw: string, into: UsageEvent[]): void {
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && e.v === 1 && KEEP[e.type]) into.push(e);
    } catch {}
  }
}

/** All events, oldest first. `tailBytes` reads only the end of the current file (the hook's cheap path). */
export function readUsage(repoRoot: string, tailBytes?: number): UsageEvent[] {
  const out: UsageEvent[] = [];
  const path = usagePath(repoRoot);
  if (tailBytes === undefined) {
    try { parseLines(readFileSync(`${path}.1`, "utf8"), out); } catch {}
    try { parseLines(readFileSync(path, "utf8"), out); } catch {}
    return out;
  }
  try {
    const size = statSync(path).size;
    const len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len);
    const fd = openSync(path, "r");
    try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
    let raw = buf.toString("utf8");
    if (len < size) raw = raw.slice(raw.indexOf("\n") + 1); // drop the cut first line
    parseLines(raw, out);
  } catch {}
  return out;
}

/**
 * Vault-relative result paths of a search tool response. Real Claude Code payloads give an array
 * `[{type:"text", text}]`; a plain string and `{content:[…]}` are accepted too. The text is a JSON array of
 * `{path,…}`, optionally followed by a `[stale: …]` block; the indexing message is not JSON and gives `[]`.
 */
export function parseSearchResponse(resp: unknown): string[] {
  let text: string | undefined;
  if (typeof resp === "string") text = resp;
  else {
    const parts = Array.isArray(resp) ? resp : Array.isArray((resp as any)?.content) ? (resp as any).content : [];
    text = parts.find((p: any) => typeof p?.text === "string")?.text;
  }
  if (!text) return [];
  const start = text.indexOf("[");
  if (start < 0 || text.slice(0, start).trim()) return [];
  const end = text.lastIndexOf("]");
  // the stale block starts with "[stale:", after the array; try each closing bracket from the right
  for (let e = end; e > start; e = text.lastIndexOf("]", e - 1)) {
    try {
      const arr = JSON.parse(text.slice(start, e + 1));
      return Array.isArray(arr) ? arr.map((r) => r?.path).filter((p): p is string => typeof p === "string") : [];
    } catch {}
  }
  return [];
}

/** The search a read or fallback belongs to: same session (and server), inside the window; the newest one whose results hold `path`, else the newest. */
export function matchSearch(
  events: UsageEvent[],
  q: { session: string; now?: number; path?: string; server?: string },
): { search: SearchEvent; rank: number | null } | null {
  const now = q.now ?? Date.now();
  const hits = events
    .filter((e): e is SearchEvent => e.type === "search" && e.session === q.session && (!q.server || e.server === q.server))
    .filter((e) => now - Date.parse(e.ts) <= WINDOW_MS && Date.parse(e.ts) <= now)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const rankIn = (s: SearchEvent) => (q.path ? s.results.indexOf(q.path) : -1);
  const best = (q.path && hits.find((s) => rankIn(s) >= 0)) || hits[0];
  if (!best) return null;
  const i = rankIn(best);
  return { search: best, rank: i >= 0 ? i + 1 : null };
}

export interface Gap { query: string; used_doc: string | null; suggested: string; count: number; last_seen: string; signals: string[] }

const jaccard = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return a.size + b.size - n ? n / (a.size + b.size - n) : 0;
};

/**
 * Searches that did not end well: no `use`, a `fallback` before the first `use`, or a doc used that was not in the
 * results. Fallbacks outside a vault count only with `includeRepoGrep`. Grouped without an LLM: by used doc, else
 * greedily by token Jaccard >= 0.5. Queries are redacted again; one still holding [REDACTED] is dropped.
 */
export function computeGaps(events: UsageEvent[], opts: { since?: string; includeRepoGrep?: boolean } = {}): Gap[] {
  const uses = new Map<string, UseEvent[]>();
  const falls = new Map<string, FallbackEvent[]>();
  for (const e of events) {
    if (e.type === "use") uses.set(e.search, [...(uses.get(e.search) ?? []), e]);
    else if (e.type === "fallback" && (e.scope === "vault" || opts.includeRepoGrep)) falls.set(e.search, [...(falls.get(e.search) ?? []), e]);
  }
  type Row = { query: string; doc: string | null; ts: string; signals: string[] };
  const rows: Row[] = [];
  for (const s of events) {
    if (s.type !== "search" || (opts.since && s.ts < opts.since)) continue;
    const u = (uses.get(s.id) ?? []).sort((a, b) => a.ts.localeCompare(b.ts));
    const f = falls.get(s.id) ?? [];
    const signals: string[] = [];
    if (!u.length) signals.push("no selection");
    if (f.some((x) => !u.length || x.ts < u[0].ts)) signals.push("grep fallback");
    if (u.some((x) => x.rank === null)) signals.push("not in results");
    if (!signals.length) continue;
    const query = redact(s.query, "broad").text.trim();
    if (!query || query.includes(REDACTED)) continue;
    rows.push({ query, doc: u[0]?.path ?? null, ts: s.ts, signals });
  }
  const groups: { doc: string | null; tokens: Set<string>; rows: Row[] }[] = [];
  for (const r of rows) {
    const tokens = new Set(tokenize(r.query));
    const g = groups.find((x) => (r.doc ? x.doc === r.doc : x.doc === null && jaccard(x.tokens, tokens) >= 0.5));
    if (g) { g.rows.push(r); for (const t of tokens) g.tokens.add(t); } else groups.push({ doc: r.doc, tokens, rows: [r] });
  }
  return groups.map((g) => {
    const freq = new Map<string, number>();
    for (const r of g.rows) freq.set(r.query, (freq.get(r.query) ?? 0) + 1);
    const query = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]; // ties: first seen
    return {
      query,
      used_doc: g.doc,
      suggested: g.doc ? "symptoms.user_phrase" : "new doc",
      count: g.rows.length,
      last_seen: g.rows.map((r) => r.ts).sort().pop()!.slice(0, 10),
      signals: [...new Set(g.rows.flatMap((r) => r.signals))],
    };
  });
}

/** The `gaps.v1` document hewtd's `reconcile --gaps` reads: no extra fields (signals stay in the text report). */
export const toGapsV1 = (gaps: Gap[], version: string) => ({
  version: 1 as const,
  source: `semantic-memory ${version}`,
  gaps: gaps.map(({ query, used_doc, suggested, count, last_seen }) => ({ query, used_doc, suggested, count, last_seen })),
});

/** Deterministic tune/heldout split on the normalized query: the same query always lands on the same side. */
export const splitOf = (q: string): "tune" | "heldout" => {
  let h = 0;
  for (const c of tokenize(q).join(" ")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 4 === 0 ? "heldout" : "tune";
};

/** `eval` question-set lines (FacetCase): one per distinct query whose search ended in a used doc. */
export function usageEvalSet(events: UsageEvent[]): { id: string; tier: "paraphrase"; q: string; expected: string[]; split: "tune" | "heldout" }[] {
  const byQuery = new Map<string, Set<string>>();
  const used = new Map<string, string[]>();
  for (const e of events) if (e.type === "use") used.set(e.search, [...(used.get(e.search) ?? []), e.path]);
  for (const s of events) {
    if (s.type !== "search" || !used.has(s.id)) continue;
    const q = redact(s.query, "broad").text.trim();
    if (!q || q.includes(REDACTED)) continue;
    const key = tokenize(q).join(" ");
    byQuery.set(key, new Set([...(byQuery.get(key) ?? []), ...used.get(s.id)!])); // key -> docs; first wording below
  }
  const wording = new Map<string, string>();
  for (const s of events) if (s.type === "search" && used.has(s.id)) {
    const q = redact(s.query, "broad").text.trim();
    const key = tokenize(q).join(" ");
    if (byQuery.has(key) && !wording.has(key) && q && !q.includes(REDACTED)) wording.set(key, q);
  }
  return [...byQuery.entries()].map(([key, docs], i) => ({
    id: `usage-${String(i + 1).padStart(3, "0")}`,
    tier: "paraphrase" as const,
    q: wording.get(key)!,
    expected: [...docs],
    split: splitOf(key),
  }));
}

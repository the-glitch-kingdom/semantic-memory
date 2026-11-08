import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCitationCounts } from "../../src/core/usage-boost.js";
import {
  appendUsage, computeGaps, matchSearch, parseSearchResponse, readUsage, usageEvalSet, usagePath, WINDOW_MS, type UsageEvent,
} from "../../src/core/usage-log.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "usage-log-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const T0 = Date.parse("2026-11-07T10:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const search = (id: string, q: string, results: string[], o: Partial<UsageEvent> = {}): UsageEvent =>
  ({ v: 1, type: "search", ts: iso(0), session: "s1", id, server: "docs", tool: "search_hybrid", query: q, results, ...o }) as UsageEvent;
const use = (sid: string, path: string, rank: number | null, ms = 1000): UsageEvent =>
  ({ v: 1, type: "use", ts: iso(ms), session: "s1", search: sid, server: "docs", path, rank, via: "Read" });
const fall = (sid: string, ms = 500, scope: "vault" | "repo" = "vault"): UsageEvent =>
  ({ v: 1, type: "fallback", ts: iso(ms), session: "s1", search: sid, via: "Grep", scope });

describe("appendUsage / readUsage", () => {
  it("writes whitelisted fields, redacts the query, caps results, refuses selection", () => {
    const results = Array.from({ length: 30 }, (_, i) => `d${i}.md`);
    expect(appendUsage(root, { type: "search", session: "s", id: "a", server: "d", tool: "t", query: "key AKIAABCDEFGHIJKLMNOP", results, content: "SECRET-BODY" })).toBe(true);
    expect(appendUsage(root, { type: "selection", path: "x.md" })).toBe(false);
    const raw = readFileSync(usagePath(root), "utf8");
    expect(raw).not.toContain("AKIA");
    expect(raw).not.toContain("SECRET-BODY");
    const [e] = readUsage(root) as any[];
    expect(e.v).toBe(1);
    expect(e.results).toHaveLength(20);
  });
  it("rotates past the size cap and reads both files; tail read drops the cut line", () => {
    appendUsage(root, { type: "fallback", session: "s", search: "a", via: "Grep", scope: "vault" }, { SEMANTIC_MEMORY_USAGE_LOG_MB: "0.00001" } as any);
    appendUsage(root, { type: "fallback", session: "s", search: "b", via: "Grep", scope: "vault" }, { SEMANTIC_MEMORY_USAGE_LOG_MB: "0.00001" } as any);
    expect(existsSync(`${usagePath(root)}.1`)).toBe(true);
    expect(readUsage(root)).toHaveLength(2);
    expect(readUsage(root, 40).length).toBeLessThanOrEqual(1);
    expect(readUsage(join(root, "none"))).toEqual([]);
  });
  it("does not change loadCitationCounts", async () => {
    const before = JSON.stringify(await loadCitationCounts(root));
    appendUsage(root, { type: "use", session: "s", search: "a", server: "d", path: "x.md", rank: 1, via: "Read" });
    expect(JSON.stringify(await loadCitationCounts(root))).toBe(before);
  });
});

describe("parseSearchResponse", () => {
  const body = JSON.stringify([{ path: "a.md" }, { path: "b/c.md" }], null, 2);
  it("takes the array, string and content forms", () => {
    expect(parseSearchResponse([{ type: "text", text: body }])).toEqual(["a.md", "b/c.md"]);
    expect(parseSearchResponse(body)).toEqual(["a.md", "b/c.md"]);
    expect(parseSearchResponse({ content: [{ type: "text", text: body }] })).toEqual(["a.md", "b/c.md"]);
  });
  it("ignores the trailing stale block", () => {
    expect(parseSearchResponse([{ type: "text", text: `${body}\n\n[stale: a.md (1y), b/c.md (2y)]` }])).toEqual(["a.md", "b/c.md"]);
  });
  it("gives [] for the indexing message, junk and empties", () => {
    expect(parseSearchResponse([{ type: "text", text: "Index is still building [50%], retry" }])).toEqual([]);
    expect(parseSearchResponse(undefined)).toEqual([]);
    expect(parseSearchResponse([])).toEqual([]);
    expect(parseSearchResponse("[not json")).toEqual([]);
  });
  it("parses the real fixture", () => {
    const fx = JSON.parse(readFileSync("test/fixtures/usage-capture/mcp-search_hybrid.json", "utf8"));
    expect(parseSearchResponse(fx.tool_response)[0]).toBe("operational/rotating-api-keys.md");
  });
});

describe("matchSearch", () => {
  const evs = [search("old", "q", ["a.md"], { ts: iso(-60_000) }), search("new", "q2", ["b.md"])];
  it("prefers the newest search holding the doc, else the newest", () => {
    expect(matchSearch(evs, { session: "s1", now: T0 + 1000, path: "a.md" })).toMatchObject({ search: { id: "old" }, rank: 1 });
    expect(matchSearch(evs, { session: "s1", now: T0 + 1000, path: "zzz.md" })).toMatchObject({ search: { id: "new" }, rank: null });
  });
  it("isolates sessions and servers", () => {
    expect(matchSearch(evs, { session: "other", now: T0 + 1000 })).toBeNull();
    expect(matchSearch(evs, { session: "s1", now: T0 + 1000, server: "x" })).toBeNull();
  });
  it("honours the window edge", () => {
    const one = [search("a", "q", ["a.md"])];
    expect(matchSearch(one, { session: "s1", now: T0 + WINDOW_MS })).not.toBeNull();
    expect(matchSearch(one, { session: "s1", now: T0 + WINDOW_MS + 1 })).toBeNull();
  });
});

describe("computeGaps", () => {
  it("flags no-selection, fallback-first and not-in-results; skips clean searches", () => {
    const evs = [
      search("a", "deploy steps", ["d.md"]), use("a", "d.md", 1),
      search("b", "rotate keys", ["k.md"]),
      search("c", "cache flush", ["x.md"]), fall("c"), use("c", "y.md", null),
      search("d", "lonely fallback", ["x.md"], { ts: iso(5000) }), fall("d", 6000),
    ];
    const g = computeGaps(evs);
    expect(g.map((x) => [x.query, x.used_doc, x.suggested])).toEqual([
      ["rotate keys", null, "new doc"],
      ["cache flush", "y.md", "symptoms.user_phrase"],
      ["lonely fallback", null, "new doc"],
    ]);
    expect(g[1].signals).toEqual(["grep fallback", "not in results"]);
  });
  it("repo-scope fallbacks count only with includeRepoGrep", () => {
    const evs = [search("a", "q one", ["d.md"]), use("a", "d.md", 1, 2000), fall("a", 500, "repo")];
    expect(computeGaps(evs)).toEqual([]);
    expect(computeGaps(evs, { includeRepoGrep: true })).toHaveLength(1);
  });
  it("groups by used doc, then by Jaccard, and picks the most frequent wording", () => {
    const evs = [
      search("a", "tls cert expired", [], { ts: iso(0) }), use("a", "tls.md", null),
      search("b", "certificate renewal", [], { ts: iso(10) }), use("b", "tls.md", null),
      search("c", "tls cert expired", [], { ts: iso(20) }), use("c", "tls.md", null),
      search("d", "redis memory limit", []), search("e", "redis memory limit eviction", []),
    ];
    const g = computeGaps(evs);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ query: "tls cert expired", count: 3, used_doc: "tls.md", last_seen: "2026-11-07" });
    expect(g[1]).toMatchObject({ count: 2, used_doc: null });
  });
  it("drops queries that redact and honours since", () => {
    const evs = [search("a", "token AKIAABCDEFGHIJKLMNOP", []), search("b", "plain miss", [], { ts: iso(100) })];
    expect(computeGaps(evs).map((x) => x.query)).toEqual(["plain miss"]);
    expect(computeGaps(evs, { since: iso(200) })).toEqual([]);
  });
});

describe("usageEvalSet", () => {
  it("emits one split-tagged case per used query, deterministic, none for unused", () => {
    const evs = [search("a", "deploy steps", ["d.md"]), use("a", "d.md", 1), search("b", "deploy steps", ["d.md"]), use("b", "d2.md", null), search("c", "nothing used", [])];
    const set = usageEvalSet(evs);
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({ q: "deploy steps", expected: ["d.md", "d2.md"] });
    expect(["tune", "heldout"]).toContain(set[0].split);
    expect(usageEvalSet(evs)).toEqual(set);
  });
});

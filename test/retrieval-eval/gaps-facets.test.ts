// #101 Phase 2: acceptance for the richer `eval --gaps-out`, the nearest-doc diagnosis line and the code-line facet warning,
// written before the code. `it.fails` cases become plain `it` in Phases 3-4. Shapes follow hit-em-with-the-docs main 4a49bc9
// src/core/reconcile/gaps.ts `parse_gaps`: `nearest_doc` is {path, facet_coverage, rank: number|null}, and an ABSENT nearest_doc
// means "none" (parse_gaps rejects null: `"nearest_doc" must be {path, facet_coverage, rank}`), so the topic-absent entry omits it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/mcp/server.js";
import { toGapsV1 } from "../../src/core/usage-log.js";
import { writeDefaults } from "../../src/core/retrieval-eval/targets.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FIXTURE = join(HERE, "..", "fixtures", "docs-vault");
const CLI = join(ROOT, "dist", "cli", "index.js");
const HEWTD_341 = join(ROOT, "node_modules", "@theglitchking", "hit-em-with-the-docs", "dist", "cli", "index.js");
// a local checkout of hit-em-with-the-docs (read-only here); its built dist holds the parser at or after 4a49bc9
const HEWTD_BUILD = process.env.HEWTD_BUILD ?? join(ROOT, "..", "hit-em-with-the-docs", "dist", "core", "reconcile", "gaps.js");
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

// log-rotation.md says "roll over at 50 MB" and "newest 5 files" but nothing about compression after rotation
const NEAR = { id: "near-miss", tier: "paraphrase", q: "When do gateway logs roll over and are the old ones compressed?", facets: ["roll over at 50 ?MB", "newest 5 files", "zzqqxx-gzip-after-rotation"], expected: ["operational/log-rotation.md"], blind: true };
const ABSENT = { id: "absent", tier: "exact", q: "How is the zzqqxx quorum elected?", facets: ["zzqqxx-quorum", "zzqqxx-election"], blind: true };
const CODE_MISS = { id: "code-miss", tier: "exact", q: "Which class handles zzqqxx requests?", facets: ["class ZzqqxxHandler:"], blind: true };
const CODE_HIT = { id: "code-hit", tier: "exact", q: "How long is the zzttl cache kept?", facets: ["_TTL_SECONDS = 24 \\* 60 \\* 60"], blind: true };
const PROSE_MISS = { id: "prose-miss", tier: "exact", q: "A prose question about nothing", facets: ["zzqqxx-no-such-term"], blind: true };

let dir = "";
let setFile = "";
let codeSet = "";
let gapsFile = "";
const run = (evalDir: string, set: string, ...a: string[]) => spawnSync("node", [CLI, "eval", "--notes", dir, "--set", set, "--dir", evalDir, ...a], { encoding: "utf-8" });
const json = (evalDir: string, set: string, ...a: string[]) => {
  const r = run(evalDir, set, "--json", ...a);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};
const gapsOf = () => JSON.parse(readFileSync(gapsFile, "utf-8")).gaps as any[];

// copied from hit-em-with-the-docs 4a49bc9 src/core/reconcile/gaps.ts (the per-key checks of parse_gaps), for when no build is present
function checkEntry(g: any): string[] {
  const errs: string[] = [];
  if (typeof g.query !== "string" || !g.query.trim()) errs.push("query");
  for (const k of ["id", "tier"]) if (g[k] !== undefined && typeof g[k] !== "string") errs.push(k);
  if (g.blind !== undefined && typeof g.blind !== "boolean") errs.push("blind");
  for (const k of ["facets", "missing_facets", "expected"]) if (g[k] !== undefined && (!Array.isArray(g[k]) || g[k].some((x: unknown) => typeof x !== "string"))) errs.push(k);
  const n = g.nearest_doc;
  if (n !== undefined && (!n || typeof n.path !== "string" || (n.facet_coverage !== undefined && typeof n.facet_coverage !== "string") || (n.rank != null && !Number.isInteger(n.rank)))) errs.push("nearest_doc");
  return errs;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "sp-gaps-facets-"));
  await cp(FIXTURE, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
  await writeFile(join(dir, "reference", "ttl-cache.md"), "---\ntitle: TTL Cache\ntags: [reference]\ndomain: reference\n---\n\n# TTL Cache\n\nEntries live for a day: `_TTL_SECONDS = 24 * 60 * 60`.\n");
  await createServer(dir, { watch: false, waitForReady: true });
  setFile = join(dir, "gaps-facets.jsonl");
  codeSet = join(dir, "code-facets.jsonl");
  gapsFile = join(dir, "gaps-facets-out.json");
  await writeFile(setFile, jsonl([NEAR, ABSENT]));
  await writeFile(codeSet, jsonl([CODE_MISS, CODE_HIT, PROSE_MISS]));
}, 120_000);
afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

describe("--gaps-out carries facets, missing_facets and nearest_doc", () => {
  it("a one-missing-detail miss: id, tier, blind, facets, missing_facets, nearest_doc {path, facet_coverage, rank}, expected", () => {
    json(join(dir, "ev-a"), setFile, "--gaps-out", gapsFile);
    const g = gapsOf().find((x) => x.id === "near-miss");
    expect(g).toBeTruthy();
    expect(g).toMatchObject({ query: NEAR.q, tier: "paraphrase", blind: true, facets: NEAR.facets, missing_facets: ["zzqqxx-gzip-after-rotation"], expected: NEAR.expected });
    expect(g.nearest_doc).toMatchObject({ path: "operational/log-rotation.md", facet_coverage: "2/3" });
    expect(g.nearest_doc.rank === null || Number.isInteger(g.nearest_doc.rank)).toBe(true);
  });

  it("a topic-absent miss lists every facet as missing and omits nearest_doc (parse_gaps rejects null)", () => {
    json(join(dir, "ev-b"), setFile, "--gaps-out", gapsFile);
    const g = gapsOf().find((x) => x.id === "absent");
    expect(g).toBeTruthy();
    expect(g).toMatchObject({ tier: "exact", blind: true, facets: ABSENT.facets, missing_facets: ABSENT.facets });
    expect(g).not.toHaveProperty("nearest_doc");
    expect(g).not.toHaveProperty("expected"); // only when the row has it
  });

  it("hit-em-with-the-docs' parse_gaps shape accepts every entry (checks copied from 4a49bc9)", () => {
    json(join(dir, "ev-c"), setFile, "--gaps-out", gapsFile);
    const gaps = gapsOf();
    expect(gaps.map((g) => g.id).sort()).toEqual(["absent", "near-miss"]);
    for (const g of gaps) expect(checkEntry(g), g.id).toEqual([]);
  });

  // parse_gaps itself, from a local build of hit-em-with-the-docs main (read-only); skipped when no build is present
  (existsSync(HEWTD_BUILD) ? it : it.skip)("the built parse_gaps reads the file with no errors and keeps facets, missing_facets, nearest_doc and expected", async () => {
    json(join(dir, "ev-d"), setFile, "--gaps-out", gapsFile);
    const { parse_gaps } = await import(HEWTD_BUILD);
    const read = parse_gaps(readFileSync(gapsFile, "utf-8"), { docs_root: dir });
    expect(read.errors).toEqual([]);
    const near = read.gaps.find((g: any) => g.id === "near-miss");
    expect(near.facets).toEqual(NEAR.facets);
    expect(near.missing_facets).toEqual(["zzqqxx-gzip-after-rotation"]);
    expect(near.nearest_doc.path).toBe("operational/log-rotation.md");
    expect(near.expected).toEqual(NEAR.expected);
    expect(read.gaps.find((g: any) => g.id === "absent").nearest_doc).toBeUndefined();
  });

  // hit-em-with-the-docs 3.4.1 predates the facet fields: it must ignore them, not fail on them
  const reconcile341 = async (file: string) => {
    const proj = await mkdtemp(join(tmpdir(), "sp-gaps-341-"));
    try {
      await cp(FIXTURE, join(proj, ".documentation"), { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
      const r = spawnSync("node", [HEWTD_341, "reconcile", "--gaps", file, "--json"], { cwd: proj, encoding: "utf-8" });
      return r;
    } finally { await rm(proj, { recursive: true, force: true }); }
  };

  it("hewtd 3.4.1 `reconcile --gaps --json` accepts a file with the richer fields (unknown fields ignored)", async () => {
    const f = join(dir, "rich-by-hand.json");
    const rich = { version: 1, source: "semantic-memory test", gaps: [{ query: ABSENT.q, used_doc: null, suggested: "new doc", count: 1, last_seen: "2026-11-14", id: "absent", tier: "exact", blind: true, facets: ABSENT.facets, missing_facets: ABSENT.facets }, { query: NEAR.q, used_doc: null, suggested: "new doc", count: 1, last_seen: "2026-11-14", id: "near-miss", tier: "paraphrase", blind: true, facets: NEAR.facets, missing_facets: ["zzqqxx-gzip-after-rotation"], nearest_doc: { path: "operational/log-rotation.md", facet_coverage: "2/3", rank: null }, expected: NEAR.expected }] };
    await writeFile(f, JSON.stringify(rich));
    const r = await reconcile341(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/invalid|unsupported/i);
  });

  it("hewtd 3.4.1 `reconcile --gaps --json` accepts the file `eval --gaps-out` writes", async () => {
    json(join(dir, "ev-e"), setFile, "--gaps-out", gapsFile);
    expect(gapsOf().length).toBe(2);
    expect(gapsOf().every((g) => Array.isArray(g.facets))).toBe(true); // the richer file, not today's five fields
    const r = await reconcile341(gapsFile);
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("Diagnosis: nearest doc", () => {
  it("each coverage line ends with `nearest: <path> k/n`, or `nearest: none`", () => {
    const text = run(join(dir, "ev-f"), setFile).stdout;
    expect(text).toMatch(/^ {2}near-miss: coverage, .*nearest: operational\/log-rotation\.md 2\/3$/m);
    expect(text).toMatch(/^ {2}absent: coverage, .*nearest: none$/m);
  });

  it("--json diagnosis.cases[] gains missing_facets and nearest_doc on coverage cases", () => {
    const cases = json(join(dir, "ev-g"), setFile).diagnosis.cases;
    const near = cases.find((c: any) => c.id === "near-miss");
    expect(near.missing_facets).toEqual(["zzqqxx-gzip-after-rotation"]);
    expect(near.nearest_doc).toMatchObject({ path: "operational/log-rotation.md", facet_coverage: "2/3" });
    const absent = cases.find((c: any) => c.id === "absent");
    expect(absent.missing_facets).toEqual(ABSENT.facets);
    expect(absent.nearest_doc ?? null).toBeNull();
  });

  // Guard: ranking and grounding cases keep today's fields; the coverage-only additions never leak onto them.
  it("ranking and grounding cases carry neither missing_facets nor nearest_doc", () => {
    const cases = json(join(dir, "ev-h"), setFile).diagnosis.cases;
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases.filter((x: any) => x.label !== "coverage")) {
      expect(c, c.id).not.toHaveProperty("missing_facets");
      expect(c, c.id).not.toHaveProperty("nearest_doc");
    }
  });
});

describe("code-line facet warning", () => {
  const warnings = (stderr: string, needle: string) => stderr.split("\n").filter((l) => l.includes(needle));

  it("a code-line facet that matches no doc warns once on stderr with the id and the facet; a prose facet and a matching code-line facet do not", () => {
    const r = run(join(dir, "ev-i"), codeSet, "--json");
    expect(r.status, r.stderr).toBe(0);
    const miss = warnings(r.stderr, "class ZzqqxxHandler:");
    expect(miss).toHaveLength(1);
    expect(miss[0]).toContain("code-miss");
    expect(warnings(r.stderr, "code-hit")).toEqual([]);
    expect(warnings(r.stderr, "_TTL_SECONDS")).toEqual([]);
    expect(warnings(r.stderr, "prose-miss")).toEqual([]);
    expect(warnings(r.stderr, "zzqqxx-no-such-term")).toEqual([]);
  });

  // Guard: the warning never changes labels, and stdout stays parseable.
  it("the code-line facet that matches no doc is still a coverage miss, and the prose miss too", () => {
    const out = json(join(dir, "ev-j"), codeSet);
    const label = (id: string) => out.diagnosis.cases.find((c: any) => c.id === id)?.label;
    expect(label("code-miss")).toBe("coverage");
    expect(label("prose-miss")).toBe("coverage");
    expect(label("code-hit")).not.toBe("coverage");
  });
});

describe("facet-shape rule in the guides", () => {
  const rule = (t: string) => {
    expect(t).toMatch(/code[- ]line facet/i);
    expect(t).toMatch(/prose/i);
    expect(t).toContain("25/25"); // #101's numbers: 25/25 coverage with code-line facets
  };

  it("BLIND-SETS.md (from `eval init`) states the rule", () => {
    const d = join(dir, "guide-init");
    writeDefaults(d);
    rule(readFileSync(join(d, "BLIND-SETS.md"), "utf-8"));
  });

  it("docs/measure-and-tune.md states the rule", () => {
    rule(readFileSync(join(ROOT, "docs", "measure-and-tune.md"), "utf-8"));
  });
});

describe("usage-log gaps stay as they are", () => {
  // Guard: `semantic-memory gaps --json` is byte-identical to main (five classic fields, no facet fields).
  it("`gaps --json` prints exactly the five classic fields per entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "sp-gaps-usage-"));
    try {
      await mkdir(join(root, ".claude", ".semantic-memory"), { recursive: true });
      const ev = [
        { v: 1, type: "search", ts: "2026-11-07T10:00:00.000Z", session: "s1", id: "a", server: "docs", tool: "search_hybrid", query: "rotate keys", results: ["k.md"] },
        { v: 1, type: "search", ts: "2026-11-07T10:05:00.000Z", session: "s1", id: "b", server: "docs", tool: "search_hybrid", query: "cache flush", results: ["x.md"] },
        { v: 1, type: "use", ts: "2026-11-07T10:05:01.000Z", session: "s1", search: "b", server: "docs", path: "y.md", rank: null, via: "Read" },
      ];
      const { usagePath } = await import("../../src/core/usage-log.js");
      await mkdir(dirname(usagePath(root)), { recursive: true });
      await writeFile(usagePath(root), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
      const r = spawnSync("node", [CLI, "gaps", "--json", "--root", root], { encoding: "utf-8" });
      expect(r.status, r.stderr).toBe(0);
      const version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf-8")).version;
      const expected = JSON.stringify({ version: 1, source: `semantic-memory ${version}`, gaps: [
        { query: "rotate keys", used_doc: null, suggested: "new doc", count: 1, last_seen: "2026-11-07" },
        { query: "cache flush", used_doc: "y.md", suggested: "symptoms.user_phrase", count: 1, last_seen: "2026-11-07" },
      ] }, null, 2) + "\n";
      expect(r.stdout).toBe(expected);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("toGapsV1 drops everything but the five classic fields, even when an entry carries facets", () => {
    const g = { query: "q", used_doc: null, suggested: "new doc", count: 1, last_seen: "2026-11-14", signals: [], facets: ["x"], nearest_doc: { path: "a.md" } } as any;
    expect(Object.keys(toGapsV1([g], "x").gaps[0])).toEqual(["query", "used_doc", "suggested", "count", "last_seen"]);
  });
});

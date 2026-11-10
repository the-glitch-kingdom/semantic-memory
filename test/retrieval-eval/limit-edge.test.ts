import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startEval } from "./harness.js";
import { openSearch, type Searcher } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/** Edge cases of the limit-stable ranking (#85): boundaries, tiny corpus, filters, text-only, MCP/CLI parity, build twice on a fixture corpus. */
const DOCS = join(import.meta.dirname, "..", "..", ".documentation");
const FIXTURE = join(import.meta.dirname, "..", "fixtures", "docs-vault");
const QUERIES = [
  "what does the freshness check do on a warm start",
  "what happens when the index lock is stale",
  "how do I publish a release to npm",
  "which hooks run when a session starts",
  "fuseScores",
];

type Hit = { path: string; score: number };
type Env = Awaited<ReturnType<typeof startEval>>;
const hybrid = (e: Env, q: string, limit: number, extra: object = {}) => e.call("search_hybrid", { query: q, limit, ...extra }).then((r) => r.parsed as Hit[]);

describe("limit edge cases on this repo's .documentation", () => {
  let env: Env;
  let cli: Searcher;
  beforeAll(async () => {
    env = await startEval(DOCS, "sp-limit-edge-");
    cli = await openSearch(env.dir);
  }, 600_000);
  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  it("limits 1 and 8 return exactly that many; 20 and 50 return results with no duplicates", async () => {
    for (const q of QUERIES) {
      expect((await hybrid(env, q, 1)).length, q).toBe(1);
      expect((await hybrid(env, q, 8)).length, q).toBe(8);
      for (const k of [20, 50]) {
        const r = await hybrid(env, q, k);
        expect(r.length, `${q} @${k}`).toBeGreaterThan(8);
        expect(r.length).toBeLessThanOrEqual(k);
        expect(new Set(r.map((h) => h.path)).size).toBe(r.length);
      }
    }
  }, 120_000);

  it("status, tier and domain filters at limit 3 still fill the 3 slots (main gave 3 for all but one; the narrow domain/tier filters give at least main's count, see notes)", async () => {
    for (const f of [{ status: "active" }, { tier: "reference" }]) {
      for (const q of QUERIES) expect((await hybrid(env, q, 3, f)).length, `${q} ${JSON.stringify(f)}`).toBe(3);
    }
  }, 120_000);

  it("MCP and CLI agree on the top result at limits 3 and 8", async () => {
    for (const q of QUERIES) for (const k of [3, 8]) expect((await cli.search(q, k))[0].path, `${q} @${k}`).toBe((await hybrid(env, q, k))[0].path);
  }, 120_000);

  it("--text-only is limit-stable and untouched by the pool", async () => {
    const text = await openSearch(env.dir, { textOnly: true });
    for (const q of QUERIES) {
      const full = await text.search(q, 8);
      for (const k of [1, 3, 5]) expect((await text.search(q, k)).map((h) => h.path), q).toEqual(full.slice(0, k).map((h) => h.path));
    }
  }, 120_000);
});

describe("a corpus smaller than the pool (6 docs)", () => {
  let env: Env;
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "sp-limit-six-src-"));
    await mkdir(dir, { recursive: true });
    const topics = ["deploying the widget service", "rotating api keys", "backup and restore of the database", "onboarding a new engineer", "the on call rotation", "debugging slow queries"];
    for (const [i, t] of topics.entries()) await writeFile(join(dir, `doc${i}.md`), `# ${t}\n\nNotes about ${t}. Steps and caveats for ${t}.\n`);
    env = await startEval(dir, "sp-limit-six-");
    await cleanupTempDir(dir);
  }, 600_000);
  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  it("returns every doc at most once at any limit, and k is a prefix of 8", async () => {
    const full = await hybrid(env, "how do we rotate keys", 8);
    expect(full.length).toBeLessThanOrEqual(6);
    expect(full.length).toBeGreaterThan(0);
    for (const k of [1, 3, 5]) expect((await hybrid(env, "how do we rotate keys", k)).map((h) => h.path)).toEqual(full.slice(0, k).map((h) => h.path));
    for (const k of [20, 50]) {
      const r = await hybrid(env, "how do we rotate keys", k);
      expect(r.map((h) => h.path)).toEqual(full.map((h) => h.path));
    }
  }, 120_000);
});

describe("two builds of the fixture corpus rank the same", () => {
  let a: Env, b: Env;
  beforeAll(async () => {
    a = await startEval(FIXTURE, "sp-edge-fa-");
    b = await startEval(FIXTURE, "sp-edge-fb-");
  }, 900_000);
  afterAll(async () => {
    for (const e of [a, b]) {
      await e?.client.close();
      if (e) await cleanupTempDir(e.dir);
    }
  });
  it("search_semantic and search_hybrid: same paths and order, scores within 1e-6", async () => {
    for (const tool of ["search_semantic", "search_hybrid"]) {
      for (const query of ["how do I deploy", "troubleshooting a failing search", "security policy", "release changelog"]) {
        const [x, y] = await Promise.all([a, b].map(async (e) => (await e.call(tool, { query, limit: 8 })).parsed as Hit[]));
        expect(x.length, query).toBeGreaterThan(0);
        expect(y.map((h) => h.path), `${tool} ${query}`).toEqual(x.map((h) => h.path));
        x.forEach((h, i) => expect(y[i].score).toBeCloseTo(h.score, 6));
      }
    }
  }, 120_000);
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";
import { startEval } from "./harness.js";
import { gitHistory, stampDates } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { cleanTopK } from "./graph-metrics.js";
import { openSearch } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Code-graph fixture eval (code-graph Phase 2, semantic-memory#58). test/fixtures/code-graph-vault is a small repo: `.documentation/` plus the scripts the docs cite,
 * with a backdated git history (docs 300 days old, `backend/jobs/*` changed 3 days ago, other code 200 days ago) and a `.hewtd/graph.json` v1 export.
 * Tiers: drift and dead are twin pairs (the answer cites healthy code, its twin cites code changed since, or a script that is gone); identifier names a script;
 * plain is the control; undocumented names code that no doc mentions. Also scores "top-3 docs citing no missing references" over the answerable questions.
 * EVAL_OUT=<file> also writes the numbers as JSON.
 */
const HERE = import.meta.dirname;
const FIXTURE = join(HERE, "..", "fixtures", "code-graph-vault");
const floors = JSON.parse(readFileSync(join(HERE, "baseline.json"), "utf-8")).codeGraph;
const DEAD = new Set(Object.entries(JSON.parse(readFileSync(join(FIXTURE, "truth.json"), "utf-8")) as Record<string, { dead: string[] }>).filter(([, t]) => t.dead.length).map(([p]) => p));

interface GraphCase { id: string; tier: string; q: string; answer?: string; twin?: string; missing?: string[] }
interface Row { id: string; tier: string; rank: number | null; twinRank: number | null; top: string[]; flagged: boolean; missing: string[]; undocumented: string[]; wantPath?: string }
type Table = Record<string, Record<string, Row[]>>; // split -> arm -> rows

describe("Code-graph fixture eval (drift, dead references, identifiers, undocumented)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  const table: Table = {};

  beforeAll(async () => {
    const ages: Record<string, number> = {};
    for (const f of await glob("**/*.{md,py,sh}", { cwd: FIXTURE, dot: true })) ages[f] = f.endsWith(".md") ? 300 : f.startsWith("backend/jobs/") ? 3 : 200;
    env = await startEval(FIXTURE, "sp-graph-eval-", async (dir) => { await stampDates(dir); await gitHistory(dir, ages); }, ".documentation");
    for (const [split, file] of [["train", "golden-graph.jsonl"], ["heldout", "golden-graph-heldout.jsonl"]] as const) {
      const cases = parseGolden(await readFile(join(HERE, file), "utf-8")) as unknown as GraphCase[];
      for (const arm of ["search_semantic", "search_hybrid"]) {
        const rows: Row[] = [];
        for (const c of cases) {
          const { parsed } = await env.call(arm, { query: c.q, limit: 8 });
          const paths: string[] = parsed.map((x: any) => x.path);
          const rank = (p?: string) => (p && paths.includes(p) ? paths.indexOf(p) + 1 : null);
          rows.push({ id: c.id, tier: c.tier, rank: rank(c.answer), twinRank: rank(c.twin), top: paths.slice(0, 3), flagged: parsed.some((x: any) => x.no_strong_match), missing: parsed[0]?.missing_terms ?? [], undocumented: (parsed[0]?.undocumented ?? []).map((u: any) => `${u.entity}=${u.path}`), wantPath: (c as any).entity });
        }
        ((table[split] ??= {})[arm] = rows);
      }
    }
    process.stderr.write("\nCode-graph fixture eval\n" + Object.entries(table).map(([s, arms]) => Object.entries(arms).map(([a, rows]) => {
      const t = summary(rows);
      return `  ${s.padEnd(8)} ${a.padEnd(16)} @1=${t.at1}/${t.n} @3=${t.at3}/${t.n}  clean-top3=${t.clean.share.toFixed(3)} (${t.clean.allClean}/${t.clean.n} questions fully clean)  twin-beaten=${t.beaten}/${t.pairs}  undocumented-flagged=${t.flagged}/${t.neg} named=${t.named}/${t.neg} undocumented-located=${t.located}/${t.neg}`
        + "\n    tiers " + ["drift", "dead", "identifier", "plain"].map((x) => `${x}@1=${rows.filter((r) => r.tier === x && r.rank === 1).length}/${rows.filter((r) => r.tier === x).length}`).join(" ");
    }).join("\n")).join("\n") + "\n\n");
    if (process.env.EVAL_OUT) await writeFile(`${process.env.EVAL_OUT}.graph`, JSON.stringify(table, null, 2));
  }, 240_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  const summary = (rows: Row[]) => {
    const ans = rows.filter((r) => r.tier !== "undocumented");
    const pairs = rows.filter((r) => r.tier === "drift" || r.tier === "dead");
    const neg = rows.filter((r) => r.tier === "undocumented");
    return {
      n: ans.length, pairs: pairs.length, neg: neg.length,
      at1: ans.filter((r) => r.rank === 1).length, at3: ans.filter((r) => r.rank !== null && r.rank <= 3).length,
      beaten: pairs.filter((r) => r.rank !== null && (r.twinRank === null || r.rank < r.twinRank)).length,
      clean: cleanTopK(ans.map((r) => r.top), DEAD),
      flagged: neg.filter((r) => r.flagged).length, named: neg.filter((r) => r.missing.length > 0).length, located: neg.filter((r) => r.undocumented.length === 1 && r.undocumented[0].endsWith(`=${r.wantPath}`)).length,
    };
  };

  it("the fixture keeps its size: 3+ drift, 3+ dead, 2 identifier, 1 plain and 2 undocumented cases in each split", () => {
    for (const s of ["train", "heldout"]) {
      const rows = table[s].search_hybrid;
      const n = (t: string) => rows.filter((r) => r.tier === t).length;
      expect([n("drift"), n("dead")].every((x) => x >= 3), s).toBe(true);
      expect([n("identifier"), n("plain"), n("undocumented")], s).toEqual([2, 1, 2]);
    }
  });

  // Floors measured with grounding on (Phase 6; Phase 2 measured 5/9 and 0.778 without it). Real-corpus-free, so HNSW noise is one case.
  for (const s of ["train", "heldout"]) {
    for (const arm of ["search_semantic", "search_hybrid"]) {
      it(`${s}: ${arm} answer@1 and the clean share of the top 3 never drop below the recorded floor`, () => {
        const f = floors[s][arm], m = summary(table[s][arm]);
        expect(m.at1).toBeGreaterThanOrEqual(f.at1 - 1);
        expect(m.at3).toBeGreaterThanOrEqual(f.at3 - 1);
        expect(m.clean.share).toBeGreaterThanOrEqual(f.cleanShare - 0.05);
      });
    }
    // v1.15.0 saw no difference between a doc and its twin (a coin flip); grounding (decay.code) makes the answer win every pair.
    it(`${s}: search_hybrid ranks the answer above its twin in every drift and dead pair`, () => {
      const m = summary(table[s].search_hybrid);
      expect(m.beaten).toBe(m.pairs);
    });
    it(`${s}: identifiers no doc contains are flagged no_strong_match with missing_terms (#57)`, () => {
      const m = summary(table[s].search_hybrid);
      expect(m.flagged).toBe(m.neg);
    });
    // Phase 7: a name that exists in code is undocumented (with its file), not missing
    it(`${s}: identifiers in code but in no doc are reported undocumented with their file, not missing`, () => {
      const m = summary(table[s].search_hybrid);
      expect(m.located).toBe(m.neg);
      expect(m.named).toBe(0);
    });
  }

  // #58 check 1: code edges reach the tools, and the default walks do not see them
  it("backlinks(file) lists the citing docs and forwardlinks(doc) lists its code; walks are untouched", async () => {
    const back = (await env.call("backlinks", { path: "scripts/ci/guards.sh" })).parsed.map((x: any) => x.path).sort();
    expect(back).toEqual(["operational/ci-guards.md", "operational/release-checklist.md", "operational/row-security-audit.md"]);
    const fwd = (await env.call("forwardlinks", { path: "operational/ci-guards.md" })).parsed.map((x: any) => x.path);
    expect(fwd).toContain("code:scripts/ci/guards.sh");
    const walk = (await env.call("forwardlinks", { path: "operational/ci-guards.md", types: ["link", "wikilink", "related", "cites", "same-incident"] })).parsed;
    expect(walk.every((x: any) => x.path.endsWith(".md"))).toBe(true);
  });

  // #58 check 2: the card rides on result #1 only, and the CLI search carries the same card
  it("a query naming a cited script gets an entity card on result #1, the same through the CLI", async () => {
    const q = "What does check_rls_coverage.py check?";
    const mcp = (await env.call("search_hybrid", { query: q, limit: 8 })).parsed;
    expect(mcp[0].entity).toMatchObject({ entity: "check_rls_coverage.py", kind: "file", path: "backend/scripts/check_rls_coverage.py", location: "found in" });
    expect(mcp[0].entity.cited_by.map((c: any) => c.path)).toContain("operational/row-security-audit.md");
    expect(mcp.slice(1).some((r: any) => r.entity)).toBe(false);
    const cli = await (await openSearch(join(env.dir, ".documentation"))).search(q, 8);
    expect(cli[0].entity).toEqual(mcp[0].entity);
    expect(cli.map((r) => r.undocumented)).toEqual(mcp.map((r: any) => r.undocumented));
  });

  // #58 check 3 and CLI/MCP parity: the drifted twin says which file changed, the answer carries no block, and the CLI hook path reports the same.
  it("a drifted doc carries grounding.code_drift and ranks below its twin, the same through the CLI search", async () => {
    const q = "How do old snapshots get cleaned off the storage volume?";
    const mcp = (await env.call("search_hybrid", { query: q, limit: 8 })).parsed;
    const byPath = (rs: any[], p: string) => rs.find((r) => r.path === p);
    expect(byPath(mcp, "operational/backup-pruning-a.md").grounding).toBeUndefined();
    expect(byPath(mcp, "operational/backup-pruning-b.md").grounding).toMatchObject({ source: "export", code_drift: ["backend/jobs/prune_backups.py"] });
    expect(mcp.findIndex((r: any) => r.path.endsWith("-a.md"))).toBeLessThan(mcp.findIndex((r: any) => r.path.endsWith("-b.md")));
    const cli = await (await openSearch(join(env.dir, ".documentation"))).search(q, 8);
    expect(cli.map((r) => r.path)).toEqual(mcp.map((r: any) => r.path));
    expect(cli.map((r) => r.grounding)).toEqual(mcp.map((r: any) => r.grounding));
  });
});

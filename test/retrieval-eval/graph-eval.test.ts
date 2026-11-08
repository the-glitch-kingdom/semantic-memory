import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";
import { startEval } from "./harness.js";
import { gitHistory, stampDates } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { cleanTopK } from "./graph-metrics.js";
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
interface Row { id: string; tier: string; rank: number | null; twinRank: number | null; top: string[]; flagged: boolean; missing: string[] }
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
          rows.push({ id: c.id, tier: c.tier, rank: rank(c.answer), twinRank: rank(c.twin), top: paths.slice(0, 3), flagged: parsed.some((x: any) => x.no_strong_match), missing: parsed[0]?.missing_terms ?? [] });
        }
        ((table[split] ??= {})[arm] = rows);
      }
    }
    process.stderr.write("\nCode-graph fixture eval\n" + Object.entries(table).map(([s, arms]) => Object.entries(arms).map(([a, rows]) => {
      const t = summary(rows);
      return `  ${s.padEnd(8)} ${a.padEnd(16)} @1=${t.at1}/${t.n} @3=${t.at3}/${t.n}  clean-top3=${t.clean.share.toFixed(3)} (${t.clean.allClean}/${t.clean.n} questions fully clean)  twin-beaten=${t.beaten}/${t.pairs}  undocumented-flagged=${t.flagged}/${t.neg} named=${t.named}/${t.neg}`
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
      flagged: neg.filter((r) => r.flagged).length, named: neg.filter((r) => r.missing.length > 0).length,
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

  // The shipped code knows nothing about code: these are the floors it measured. Real-corpus-free, so HNSW noise is one case.
  for (const s of ["train", "heldout"]) {
    for (const arm of ["search_semantic", "search_hybrid"]) {
      it(`${s}: ${arm} answer@1 and the clean share of the top 3 never drop below the recorded floor`, () => {
        const f = floors[s][arm], m = summary(table[s][arm]);
        expect(m.at1).toBeGreaterThanOrEqual(f.at1 - 1);
        expect(m.at3).toBeGreaterThanOrEqual(f.at3 - 1);
        expect(m.clean.share).toBeGreaterThanOrEqual(f.cleanShare - 0.05);
      });
    }
    // Known gate: v1.15.0 sees no difference between a doc and its twin (about a coin flip). Phases 5 and 6 make it pass; the it.fails then flips red and becomes a real gate.
    it.fails(`${s}: search_hybrid ranks the answer above its twin in every drift and dead pair`, () => {
      const m = summary(table[s].search_hybrid);
      expect(m.beaten).toBe(m.pairs);
    });
    it(`${s}: identifiers no doc contains are flagged no_strong_match with missing_terms (#57)`, () => {
      const m = summary(table[s].search_hybrid);
      expect(m.flagged).toBe(m.neg);
      expect(m.named).toBe(m.neg);
    });
  }
});

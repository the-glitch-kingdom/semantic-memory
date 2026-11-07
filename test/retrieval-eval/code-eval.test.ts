import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { gitHistory } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Indexed-text eval (index-text-pooling-body-dates Phase 3, semantic-memory#52). test/fixtures/code-vault holds docs whose answer sits only inside
 * inline code, a fenced block, a table cell or a snake_case word, each with a same-topic distractor that lacks it; tier "plain" is the control.
 * A case is answered when the answer doc ranks first (search_semantic, search_hybrid) or is found at all (search_text, pattern = `term`).
 * EVAL_OUT=<file> also writes the numbers as JSON.
 */
const HERE = import.meta.dirname;
const FIXTURE = join(HERE, "..", "fixtures", "code-vault");
const TIERS = ["backtick", "fence", "table", "snake", "plain"];

interface CodeCase { id: string; tier: string; q: string; term: string; answer: string }
interface Row { id: string; tier: string; rank: number | null }
type Table = Record<string, Record<string, Row[]>>; // split -> arm -> rows

describe("Indexed-text eval (identifiers in code, tables and snake_case)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  const table: Table = {};

  beforeAll(async () => {
    env = await startEval(FIXTURE, "sp-code-eval-", (dir) => gitHistory(dir));
    for (const [split, file] of [["train", "golden-code.jsonl"], ["heldout", "golden-code-heldout.jsonl"]] as const) {
      const cases = parseGolden(await readFile(join(HERE, file), "utf-8")) as unknown as CodeCase[];
      const rankOf = (paths: string[], answer: string) => (paths.includes(answer) ? paths.indexOf(answer) + 1 : null);
      table[split] = { search_semantic: [], search_hybrid: [], search_text: [] };
      for (const arm of ["search_semantic", "search_hybrid"]) {
        const run = env.tool(arm);
        for (const c of cases) table[split][arm].push({ id: c.id, tier: c.tier, rank: rankOf((await run(c.q, 8)).results.map((x) => x.path), c.answer) });
      }
      for (const c of cases) {
        const { parsed } = await env.call("search_text", { pattern: c.term, limit: 8 });
        table[split].search_text.push({ id: c.id, tier: c.tier, rank: rankOf(parsed.map((x: any) => x.path), c.answer) });
      }
    }
    const at1 = (rows: Row[], tier: string) => { const rs = rows.filter((r) => r.tier === tier); return `${rs.filter((r) => r.rank === 1).length}/${rs.length}`; };
    process.stderr.write("\nIndexed-text eval (answer ranked first)\n" + Object.entries(table).map(([s, arms]) => Object.entries(arms).map(([a, rows]) =>
      `  ${s.padEnd(8)} ${a.padEnd(16)} all=${rows.filter((r) => r.rank === 1).length}/${rows.length}  ${TIERS.map((t) => `${t}=${at1(rows, t)}`).join("  ")}`).join("\n")).join("\n") + "\n\n");
    if (process.env.EVAL_OUT) await writeFile(`${process.env.EVAL_OUT}.code`, JSON.stringify(table, null, 2));
  }, 180_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  const first = (split: string, arm: string, tiers: string[]) => table[split][arm].filter((r) => tiers.includes(r.tier)).every((r) => r.rank === 1);
  const CODE = TIERS.filter((t) => t !== "plain");

  it("the fixture keeps its size: >= 2 cases per tier in each split", () => {
    for (const s of ["train", "heldout"]) for (const t of TIERS) expect(table[s].search_hybrid.filter((r) => r.tier === t).length, `${s} ${t}`).toBeGreaterThanOrEqual(2);
  });

  // #52 gates: on v1.11.0 stripMarkdown dropped this text and all six failed; the kept text makes them real gates.
  for (const s of ["train", "heldout"]) {
    for (const arm of ["search_text", "search_hybrid", "search_semantic"]) {
      it(`${s}: ${arm} ranks the doc first when its identifier sits only in code, a table or snake_case`, () => {
        expect(first(s, arm, CODE), arm).toBe(true);
      });
    }
  }
});

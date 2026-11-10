import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { openSearch, type Searcher } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/**
 * #91 part 1: a doc that does not contain an identifier of the question must not outrank one that does, when the identifier is in the corpus.
 * Each script name is in 3 docs; 4 generic exit-code docs match the rest of the question better and do not hold it.
 * Gates the identifier tier (whole-answer-ranking Phase 4).
 */
const SCRIPTS = ["check_widgets.py", "audit_ledger.sh", "verify_seals.sh", "scan_manifests.py"];
const question = (s: string) => `What does ${s} verify, and what does it return?`;

describe("identifier tier (#91 part 1)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  let cli: Searcher;
  const arms: Record<string, (q: string, k: number) => Promise<{ path: string }[]>> = {};

  beforeAll(async () => {
    env = await startEval(join(import.meta.dirname, "..", "fixtures", "identifier-tier"), "sp-identifier-tier-");
    cli = await openSearch(env.dir);
    arms.search_hybrid = async (q, k) => (await env.call("search_hybrid", { query: q, limit: k })).parsed;
    arms.cli = (q, k) => cli.search(q, k);
  }, 600_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  const holds = (s: string) => (h: { path: string }) => env.textOf(h.path).includes(s);

  for (const arm of ["search_hybrid", "cli"]) {
    for (const s of SCRIPTS) {
      it(`${arm}: the top 3 for "${s}" all contain it`, async () => {
        const top = (await arms[arm](question(s), 8)).slice(0, 3);
        expect(top.filter((h) => !holds(s)(h)).map((h) => h.path)).toEqual([]);
      });
    }
    it(`${arm}: limits 1, 3 and 5 are prefixes of limit 8 (#85)`, async () => {
      const q = question(SCRIPTS[1]);
      const full = (await arms[arm](q, 8)).map((h) => h.path);
      for (const k of [1, 3, 5]) expect((await arms[arm](q, k)).map((h) => h.path)).toEqual(full.slice(0, k));
    });
    it(`${arm}: a query that is only the identifier ranks its docs first`, async () => {
      const top = (await arms[arm](SCRIPTS[0], 8)).slice(0, 3);
      expect(top.every(holds(SCRIPTS[0]))).toBe(true);
    });
    it(`${arm}: an identifier in no doc changes nothing (main's top 2, the generic docs, stay)`, async () => {
      const top = (await arms[arm](question("purge_nothing.sh"), 8)).slice(0, 2).map((h) => h.path);
      expect(top.sort()).toEqual(["return-values-guide.md", "scripts-exit-0-on-success.md"]);
    });
  }

  it("search_hybrid: mode override still tiers (the tier keys on identifiers present, not the label)", async () => {
    const top = (await env.call("search_hybrid", { query: question(SCRIPTS[0]), limit: 8, mode: "fact" })).parsed.slice(0, 3);
    expect(top.every(holds(SCRIPTS[0]))).toBe(true);
  });
});

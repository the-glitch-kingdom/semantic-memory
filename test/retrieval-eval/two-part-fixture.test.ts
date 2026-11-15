import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { openSearch, type Searcher } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/**
 * #91 part 2, the reporter's repro (test/fixtures/two-part, 18 anonymised docs). R91-A: seo-surface-implementation.md holds all three facets in
 * one chunk; hybrid puts a merge-gate fact that matches only part 2's wording above it (fuseScores hands the BM25 #1 the full lexical share).
 * Semantic alone ranks it #1. The hybrid case is `it.fails` until the ranking fix ships on by default (Phase 5); then plain `it`.
 * R91-B is measured, not a target: the doc that answers in prose legitimately outranks the two runbooks that hold the commands.
 */
const questions = readFileSync(join(import.meta.dirname, "..", "fixtures", "two-part", "questions.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l) as { id: string; q: string });
const q = (id: string) => questions.find((c) => c.id === id)!.q;
const WHOLE = "marketing/seo-surface-implementation.md";
// the two docs that hold 3 of R91-B's 4 facets, and their hybrid rank on 1.31.0 (1-based, measured on this fixture)
const B_DOCS = { "troubleshooting/email-deliverability.md": 7, "devops/droplet-deployment.md": 12 } as const;

describe("two-part question ranking (#91 part 2)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  let cli: Searcher;
  const arms: Record<string, (q: string, k: number) => Promise<{ path: string }[]>> = {};

  beforeAll(async () => {
    env = await startEval(join(import.meta.dirname, "..", "fixtures", "two-part"), "sp-two-part-", undefined, "docs");
    cli = await openSearch(join(env.dir, "docs"));
    arms.search_hybrid = async (query, k) => (await env.call("search_hybrid", { query, limit: k })).parsed;
    arms.search_semantic = async (query, k) => (await env.call("search_semantic", { query, limit: k })).parsed;
    arms.cli = (query, k) => cli.search(query, k);
  }, 600_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  const rank = async (arm: string, query: string, doc: string) => (await arms[arm](query, 30)).findIndex((h) => h.path === doc) + 1 || 31;

  for (const arm of ["search_hybrid", "cli"]) {
    it.fails(`R91-A ${arm}: the doc holding all three facets is #1`, async () => {
      expect(await rank(arm, q("R91-A"), WHOLE)).toBe(1);
    });
  }
  it("R91-A search_semantic: the whole-answer doc is #1 today (guard)", async () => {
    expect(await rank("search_semantic", q("R91-A"), WHOLE)).toBe(1);
  });
  it.each(Object.entries(B_DOCS))("R91-B hybrid: %s is not ranked worse than %i (recorded, no target)", async (doc, today) => {
    expect(await rank("search_hybrid", q("R91-B"), doc)).toBeLessThanOrEqual(today);
  });
});

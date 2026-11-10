import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { openSearch, type Searcher } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/**
 * #91 part 2: ranking takes each doc's best single chunk, so a doc that answers every part of a question across two sections loses to
 * one whose single best chunk matches only one part. Here X (cert-rotation-runbook.md) holds the rotation answer in one strong chunk
 * and nothing on audit logs; Y (platform-handover-notes.md) answers both parts in two different sections, each weaker.
 * The two-part reproduction is `it.fails` until clause coverage lands (whole-answer-ranking Phase 5); if part 2 ships off by default it stays
 * `it.fails` with the reason. The one-part guard is plain `it`.
 */
const TWO_PART = "How do we rotate the cluster certificates, and where are the audit logs kept?";
const ONE_PART = "How do we rotate the cluster certificates?";
const X = "cert-rotation-runbook.md";
const Y = "platform-handover-notes.md";

describe("clause coverage (#91 part 2)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  let cli: Searcher;
  const arms: Record<string, (q: string, k: number) => Promise<{ path: string }[]>> = {};

  beforeAll(async () => {
    env = await startEval(join(import.meta.dirname, "..", "fixtures", "multi-clause"), "sp-multi-clause-");
    cli = await openSearch(env.dir);
    arms.search_hybrid = async (q, k) => (await env.call("search_hybrid", { query: q, limit: k })).parsed;
    arms.cli = (q, k) => cli.search(q, k);
  }, 600_000);

  afterAll(async () => {
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  for (const arm of ["search_hybrid", "cli"]) {
    it.fails(`${arm}: the doc that answers both parts across two sections beats the one with a single strong chunk`, async () => {
      const paths = (await arms[arm](TWO_PART, 8)).map((h) => h.path);
      expect(paths.indexOf(Y)).toBeGreaterThanOrEqual(0);
      expect(paths.indexOf(Y)).toBeLessThan(paths.indexOf(X));
    });
    it(`${arm}: a one-part question on the same corpus keeps the single-chunk doc first`, async () => {
      expect((await arms[arm](ONE_PART, 8))[0].path).toBe(X);
    });
  }
});

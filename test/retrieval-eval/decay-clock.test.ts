import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { openSearch, type Searcher } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

/**
 * Decay day clock (#88): within one UTC day the ranking is a pure function of the index. The same query run 40 ms apart, and at limit 5 vs 8,
 * returns identical paths and scores (exact, same process and index) for search_hybrid and the CLI. Date is faked; embedding keeps real timers.
 * Expected to fail on 1.27.0, where the multiplier drifts with the millisecond.
 */
const DOCS = join(import.meta.dirname, "..", "..", ".documentation");
const QUERIES = ["what does the freshness check do on a warm start", "how do I publish a release to npm", "how are semantic and keyword scores combined", "what is the candidate pool"];
const T0 = Date.parse("2026-11-09T10:00:00Z");

type Hit = { path: string; score: number };

describe("decay is stable within a UTC day", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  let cli: Searcher;
  const arms: Record<string, (q: string, k: number) => Promise<Hit[]>> = {};

  beforeAll(async () => {
    env = await startEval(DOCS, "sp-decay-clock-");
    cli = await openSearch(env.dir);
    arms.search_hybrid = async (q, k) => (await env.call("search_hybrid", { query: q, limit: k })).parsed as Hit[];
    arms.cli = (q, k) => cli.search(q, k);
  }, 600_000);

  afterAll(async () => {
    vi.useRealTimers();
    await env?.client.close();
    if (env) await cleanupTempDir(env.dir);
  });

  for (const tool of ["search_hybrid", "cli"]) {
    // it.fails until Phase 3 makes decay read a day clock
    it.fails(`${tool}: same query 40 ms apart, and at limit 5 vs 8, gives identical scores`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      for (const q of QUERIES) {
        vi.setSystemTime(T0);
        const first = await arms[tool](q, 8);
        expect(first.length).toBeGreaterThan(0);
        vi.setSystemTime(T0 + 40);
        const again = await arms[tool](q, 8);
        expect(again).toEqual(first);
        const five = await arms[tool](q, 5);
        expect(five.map((h) => h.score)).toEqual(first.slice(0, 5).map((h) => h.score));
      }
    }, 300_000);
  }
});

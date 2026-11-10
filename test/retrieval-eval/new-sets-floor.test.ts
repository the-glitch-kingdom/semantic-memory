import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startEval } from "./harness.js";
import { runFacetEval, parseGolden, type FacetCase } from "./eval.js";
import { cleanupTempDir } from "../setup.js";

/** Floors of the #91 sets (baseline.json newSets, whole-answer-ranking Phase 6). One case of slack: HNSW is random per build. */
const HERE = import.meta.dirname;
const floors = JSON.parse(readFileSync(join(HERE, "baseline.json"), "utf-8")).newSets;
const read = (n: string) => parseGolden(readFileSync(join(HERE, `${n}.jsonl`), "utf-8")) as unknown as FacetCase[];

describe.each([["whole-answer", "multi-hub", "wholeAnswer"], ["identifier-tier", "identifier-tier", "identifierTier"]] as const)("%s floors", (set, fixture, key) => {
  let env: Awaited<ReturnType<typeof startEval>>;
  beforeAll(async () => { env = await startEval(join(HERE, "..", "fixtures", fixture), `sp-floor-${set}-`); }, 600_000);
  afterAll(async () => { await env?.client.close(); if (env) await cleanupTempDir(env.dir); });

  for (const [split, file] of [["train", set], ["heldout", `${set}-heldout`]] as const) {
    it(`${split}: search_hybrid stays at or above the recorded floor`, async () => {
      const cases = read(file), f = floors[key][split];
      if (key === "wholeAnswer") {
        const t = (await runFacetEval(cases, env.tool("search_hybrid"), env.textOf)).tiers;
        const all = t.all ?? Object.values(t)[0];
        expect(all.at[1]).toBeGreaterThanOrEqual(f.at1 - 1);
        expect(all.at[3]).toBeGreaterThanOrEqual(f.at3 - 1);
      } else {
        let ok = 0;
        for (const c of cases) {
          const top = (await env.call("search_hybrid", { query: c.q, limit: 8 })).parsed.slice(0, 3) as { path: string }[];
          if (top.length === 3 && top.every((h) => (c.expected ?? []).some((e) => e.endsWith(`/${h.path}`)))) ok++;
        }
        expect(ok).toBeGreaterThanOrEqual(f.top3 - 1);
      }
    });
  }
});

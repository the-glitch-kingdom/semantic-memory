import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { coldChecksum } from "../../src/core/cold.js";
import { parseGolden } from "./eval.js";
import { makeProject, type Project } from "../long-term-fixture.js";

/**
 * Long-term recall (#93 Phase 8): questions over the two fixture cold generations (test/fixtures/long-term), asked with
 * sources: ["long-term"], while a third generation (a copy of this repo's `.documentation`, ~240 files) sits among them as
 * distractors. A case is found@k when its (source, path) is in the first k hits. Floors: baseline.json `longTerm`,
 * measured on train, one case of slack for HNSW. The heldout split is reported and gated at its measured value, never tuned on.
 */
interface Case { id: string; q: string; expected: { source: string; path: string }[] }
const HERE = import.meta.dirname;
const floors = JSON.parse(await readFile(join(HERE, "baseline.json"), "utf-8")).longTerm;

describe("long-term recall (fixture generations among distractors)", () => {
  let p: Project, client: Client;
  const results: Record<string, { at1: number; at3: number; n: number }> = {};
  const hitsFor = async (q: string) => {
    const r: any = await client.callTool({ name: "search_hybrid", arguments: { query: q, limit: 8, sources: ["long-term"] } });
    try { return JSON.parse(r.content[0].text) as { source: string; path: string }[]; } catch { return []; }
  };

  beforeAll(async () => {
    p = await makeProject();
    const gen = join(p.coldRoot, "2025-06-01");
    await cp(join(HERE, "..", "..", ".documentation"), gen, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
    const cfgPath = join(p.root, ".claude", "hit-em-with-the-docs.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf-8"));
    cfg.cold_storage.push({ ...cfg.cold_storage[0], generation: "2025-06-01", path: ".documentation-cold/2025-06-01", checksum: coldChecksum(gen) });
    await mkdir(join(p.root, ".claude"), { recursive: true });
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const server = await createServer(p.docs, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "lt-eval", version: "1.0.0" });
    await client.connect(ct);
    // the three cold indexes build on first use; wait until each has answered
    for (const end = Date.now() + 300_000; Date.now() < end; await new Promise((ok) => setTimeout(ok, 500))) {
      const seen = new Set((await Promise.all(["request coalescing lease", "invoice usage event batch", "documentation index search"].map(hitsFor))).flat().map((h) => h.source));
      if (seen.size >= 3) break;
    }
    for (const [split, file] of [["train", "long-term.jsonl"], ["heldout", "long-term-heldout.jsonl"]] as const) {
      const cs = parseGolden(await readFile(join(HERE, file), "utf-8")) as unknown as Case[];
      let at1 = 0, at3 = 0;
      for (const c of cs) {
        const hits = await hitsFor(c.q);
        const i = hits.findIndex((h) => c.expected.some((e) => e.source === h.source && e.path === h.path));
        if (i === 0) at1++;
        if (i >= 0 && i < 3) at3++;
      }
      results[split] = { at1, at3, n: cs.length };
    }
    process.stderr.write(`\nLong-term recall: ${Object.entries(results).map(([s, r]) => `${s} @1 ${r.at1} @3 ${r.at3} /${r.n}`).join(" | ")}\n\n`);
  }, 600_000);

  afterAll(async () => { await client?.close(); await p?.cleanup(); });

  for (const split of ["train", "heldout"]) {
    it(`${split}: found@1 and @3 stay at or above the recorded floor`, () => {
      expect(results[split].at1).toBeGreaterThanOrEqual(floors[split].at1 - 1);
      expect(results[split].at3).toBeGreaterThanOrEqual(floors[split].at3 - 1);
    });
  }
});

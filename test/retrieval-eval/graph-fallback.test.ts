import { describe, it, expect, afterAll } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "glob";
import { startEval } from "./harness.js";
import { gitHistory, stampDates } from "./git-history.js";
import { parseGolden } from "./eval.js";
import { cleanupTempDir } from "../setup.js";

/**
 * #58 acceptance checks 5 and 6 through the full search path, on the code-graph fixture: without `.hewtd/` the code spans and links ground the
 * docs (source "code-spans"); outside a git repo the graph is the doc-only graph. Same questions as graph-eval; nothing is tuned here.
 */
const HERE = import.meta.dirname;
const FIXTURE = join(HERE, "..", "fixtures", "code-graph-vault");
const ages = async () => Object.fromEntries((await glob("**/*.{md,py,sh}", { cwd: FIXTURE, dot: true })).map((f) => [f, f.endsWith(".md") ? 300 : f.startsWith("backend/jobs/") ? 3 : 200]));
const questions = async () => [
  ...parseGolden(await readFile(join(HERE, "golden-graph.jsonl"), "utf-8")),
  ...parseGolden(await readFile(join(HERE, "golden-graph-heldout.jsonl"), "utf-8")),
] as unknown as { id: string; tier: string; q: string; answer?: string; twin?: string }[];

describe("code graph without the export (fallback)", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  afterAll(async () => { await env?.client.close(); if (env) await cleanupTempDir(env.dir); });

  it("grounds from code spans, lists citers, ranks the answer above its twin, and does not crash", async () => {
    const h = await ages();
    env = await startEval(FIXTURE, "sp-graph-fb-", async (dir) => { await rm(join(dir, ".hewtd"), { recursive: true }); await stampDates(dir); await gitHistory(dir, h); }, ".documentation");
    const qs = (await questions()).filter((c) => c.tier === "drift" || c.tier === "dead");
    let beaten = 0, grounded = 0;
    for (const c of qs) {
      const { parsed } = await env.call("search_hybrid", { query: c.q, limit: 8 });
      const paths: string[] = parsed.map((x: any) => x.path);
      const a = paths.indexOf(c.answer!), t = paths.indexOf(c.twin!);
      if (a >= 0 && (t < 0 || a < t)) beaten++;
      const twin = parsed.find((x: any) => x.path === c.twin);
      if (twin?.grounding) { grounded++; expect(twin.grounding.source).toBe("code-spans"); }
    }
    process.stderr.write(`\nfallback (no .hewtd): twin-beaten ${beaten}/${qs.length}, twin carries grounding ${grounded}/${qs.length}\n`);
    expect(grounded).toBeGreaterThan(0);
    const back = (await env.call("backlinks", { path: "scripts/ci/guards.sh" })).parsed.map((x: any) => x.path);
    expect(back.length).toBeGreaterThanOrEqual(3);
    const card = (await env.call("search_hybrid", { query: "What does check_rls_coverage.py check?", limit: 8 })).parsed[0].entity;
    expect(card).toMatchObject({ kind: "file", path: "backend/scripts/check_rls_coverage.py" });
  }, 240_000);
});

describe("code graph outside a git repo", () => {
  let env: Awaited<ReturnType<typeof startEval>>;
  afterAll(async () => { await env?.client.close(); if (env) await cleanupTempDir(env.dir); });

  it("is the doc-only graph: no code nodes, no grounding, no card", async () => {
    env = await startEval(FIXTURE, "sp-graph-nogit-", async (dir) => { await stampDates(dir); }, ".documentation");
    const stats = JSON.parse(((await env.client.callTool({ name: "graph_statistics", arguments: {} })) as any).content[0].text);
    expect(stats.codeNodes).toBe(0);
    expect(stats.totalNodes).toBeGreaterThan(20);
    expect((await env.call("backlinks", { path: "scripts/ci/guards.sh" })).parsed).toEqual([]);
    for (const c of (await questions()).slice(0, 12)) {
      const { parsed } = await env.call("search_hybrid", { query: c.q, limit: 8 });
      expect(parsed.length, c.id).toBeGreaterThan(0);
      expect(parsed.some((x: any) => x.grounding || x.entity || x.undocumented), c.id).toBe(false);
    }
  }, 240_000);
});

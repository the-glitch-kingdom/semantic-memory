import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/mcp/server.js";
import { checkBaseline, findStale, loadSets, normalizeCase, type Baseline, type EvalReport } from "../../src/core/retrieval-eval/suite.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "docs-vault");
const CLI = join(HERE, "..", "..", "dist", "cli", "index.js");

describe("findStale", () => {
  const docs = new Map([["a.md", "harbor.dlq receives dead letters"]]);
  it("keeps answerable cases and reports the rest with a reason", () => {
    const cases = [
      { id: "ok", tier: "exact", q: "q", facets: ["harbor\\.dlq"] },
      { id: "gone", tier: "exact", q: "q", facets: ["nowhere"] },
      { id: "bad", tier: "exact", q: "q", facets: ["("] },
      { id: "moved", tier: "exact", q: "q", facets: ["harbor"], expected: ["b.md"] },
      { id: "neg", tier: "negative", q: "q" },
    ] as any[];
    const { live, stale } = findStale(cases, docs);
    expect(live.map((c) => c.id)).toEqual(["ok", "neg"]);
    expect(stale.map((s) => s.id)).toEqual(["gone", "bad", "moved"]);
  });
});

describe("normalizeCase (#71)", () => {
  it("scores negative: true rows as negatives and refuses a row with no tier and no facets", () => {
    expect(normalizeCase({ id: "n", q: "q", negative: true } as any).tier).toBe("negative");
    expect(normalizeCase({ id: "n", tier: "exact", q: "q", negative: true } as any).tier).toBe("negative");
    expect(normalizeCase({ id: "a", tier: "exact", q: "q", facets: ["x"] } as any).tier).toBe("exact");
    expect(() => normalizeCase({ id: "bad-row", q: "q" } as any)).toThrow(/bad-row/);
  });
  it("loadSets applies it", async () => {
    const f = join(await mkdtemp(join(tmpdir(), "sp-norm-")), "s.jsonl");
    await writeFile(f, JSON.stringify({ id: "n1", q: "q", negative: true }) + "\n");
    expect(loadSets("/x", [f])[0].tier).toBe("negative");
  });
});

describe("checkBaseline", () => {
  const arm = (a1: number, outcomes: Record<string, number>) => ({ all: { tiers: { all: { n: 4, at: { 1: a1, 3: 4, 8: 4 } } }, negativesFlagged: 1, negativeTop: [0] }, outcomes });
  const base: Baseline = { version: "1", setHash: "s", corpus: { docs: 4, hash: "c" }, arms: { x: { a1: 4, a3: 4, a8: 4, negFlagged: 1, n: 4, negN: 1, outcomes: { a: 1, b: 1, c: 1, d: 1 } } } };
  const report = (a1: number, outcomes: Record<string, number>, hash = "c") => ({ setHash: "s", corpus: { docs: 4, hash }, arms: { x: arm(a1, outcomes) } }) as unknown as EvalReport;

  it("passes a one-question drop and fails two, naming what flipped", () => {
    expect(checkBaseline(base, report(3, { a: 1, b: 1, c: 1, d: 3 })).ok).toBe(true);
    const bad = checkBaseline(base, report(2, { a: 1, b: 1, c: 3, d: 3 }));
    expect(bad.ok).toBe(false);
    expect(bad.lines).toContain("  flipped c: 1 -> 3");
    expect(bad.lines.some((l) => /binomial SD/.test(l))).toBe(true);
  });

  it("only warns when the corpus changed", () => {
    const r = checkBaseline(base, report(4, { a: 1, b: 1, c: 1, d: 1 }, "other"));
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatch(/corpus changed/);
  });
});

describe("eval CLI", () => {
  let dir = "";
  afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

  it("refuses with no index, then reports every arm and leaves the index and logs alone", async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-eval-cli-"));
    await cp(FIXTURE, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
    const set = join(dir, "..", `${dir.split("/").pop()}-set.jsonl`);
    const lines = (await import("node:fs")).readFileSync(join(HERE, "golden-docs.jsonl"), "utf-8").split("\n").filter((l) => l.startsWith("{")).slice(0, 40);
    await writeFile(set, lines.join("\n") + "\n" + JSON.stringify({ id: "stale", tier: "exact", q: "x", facets: ["zzqqxx-no-such-term"] }) + "\n");

    const run = (...a: string[]) => spawnSync("node", [CLI, "eval", "--notes", dir, "--set", set, ...a], { encoding: "utf-8" });
    const none = run();
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/--reindex/);

    await createServer(dir, { watch: false, waitForReady: true });
    const t0 = Date.now();
    const r = run("--json");
    expect(Date.now() - t0).toBeLessThan(120_000); // #56 check 1
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(Object.keys(out.arms)).toEqual(["search_hybrid", "search_semantic", "search_text", "grep"]);
    expect(out.stale.map((s: any) => s.id)).toEqual(["stale"]);
    expect(out.arms.search_hybrid.all.tiers.all.n).toBeGreaterThan(0);
    expect(out.arms.search_hybrid.all.latencyMs.p95).toBeGreaterThan(0);
    expect(existsSync(join(dir, ".semantic-sidekick-index", "selection.jsonl"))).toBe(false);
    expect(run().stdout).toMatch(/search_hybrid[\s\S]*latency/);

    const evalDir = join(dir, "evaldir");
    expect(run("--check", "--dir", evalDir).status).toBe(1);
    expect(run("--baseline", "--check", "--dir", evalDir).stderr).toMatch(/separate runs/);
    expect(run("--baseline", "--dir", evalDir).status).toBe(0);
    expect(existsSync(join(evalDir, "baseline.json"))).toBe(true);
    expect(run("--check", "--dir", evalDir).status).toBe(0);
    const base = JSON.parse(readFileSync(join(evalDir, "baseline.json"), "utf-8"));
    base.arms.search_hybrid.a1 += 5;
    await writeFile(join(evalDir, "baseline.json"), JSON.stringify(base));
    const failed = run("--check", "--dir", evalDir);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/FAIL/);
    await rm(set);
  }, 240_000);

  it("explains a missing set", () => {
    expect(() => loadSets("/nonexistent-vault", undefined, "/nonexistent-dir")).toThrow(/--set/);
  });
});

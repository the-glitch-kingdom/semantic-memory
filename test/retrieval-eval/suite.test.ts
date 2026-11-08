import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/mcp/server.js";
import { findStale, loadSets } from "../../src/core/retrieval-eval/suite.js";

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

describe("eval CLI", () => {
  let dir = "";
  afterAll(async () => dir && (await rm(dir, { recursive: true, force: true })));

  it("refuses with no index, then reports every arm and leaves the index and logs alone", async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-eval-cli-"));
    await cp(FIXTURE, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
    const set = join(dir, "..", `${dir.split("/").pop()}-set.jsonl`);
    const lines = (await import("node:fs")).readFileSync(join(HERE, "golden-docs.jsonl"), "utf-8").split("\n").filter((l) => l.startsWith("{")).slice(0, 12);
    await writeFile(set, lines.join("\n") + "\n" + JSON.stringify({ id: "stale", tier: "exact", q: "x", facets: ["zzqqxx-no-such-term"] }) + "\n");

    const run = (...a: string[]) => spawnSync("node", [CLI, "eval", "--notes", dir, "--set", set, ...a], { encoding: "utf-8" });
    const none = run();
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/--reindex/);

    await createServer(dir, { watch: false, waitForReady: true });
    const r = run("--json");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(Object.keys(out.arms)).toEqual(["search_hybrid", "search_semantic", "search_text", "grep"]);
    expect(out.stale.map((s: any) => s.id)).toEqual(["stale"]);
    expect(out.arms.search_hybrid.all.tiers.all.n).toBeGreaterThan(0);
    expect(out.arms.search_hybrid.all.latencyMs.p95).toBeGreaterThan(0);
    expect(existsSync(join(dir, ".semantic-sidekick-index", "selection.jsonl"))).toBe(false);
    expect(run().stdout).toMatch(/search_hybrid[\s\S]*latency/);
    await rm(set);
  }, 240_000);

  it("explains a missing set", () => {
    expect(() => loadSets("/nonexistent-vault", undefined, "/nonexistent-dir")).toThrow(/--set/);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { GEN_A, GEN_B, makeProject, type Project } from "../long-term-fixture.js";

// #93 Phase 6 acceptance: `search --source` resolves the label through the primary's federation, indexes into
// sourceIndexPath and never into the source folder. `it.fails` = the flag does not exist yet. (No --source: see long-term-default.test.ts.)

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli", "index.js");

describe("CLI search --source", () => {
  let p: Project;
  const search = (q: string, ...args: string[]) => {
    const r = spawnSync("node", [CLI, "search", q, "--notes", p.docs, ...args], { encoding: "utf8", timeout: 240_000 });
    return { r, hits: r.status === 0 ? (JSON.parse(r.stdout) as any[]) : [] };
  };
  beforeAll(async () => {
    p = await makeProject({ federation: "  related_repos: false\n  sources:\n    - {label: legacy, path: ../legacy-docs, default: false}\n" });
  }, 120_000);
  afterAll(() => p.cleanup());

  it.fails("--source legacy searches only that source, labels hits, and builds its index outside the source folder", () => {
    const { r, hits } = search("single entry point for client requests", "--source", "legacy");
    expect(r.status, r.stderr).toBe(0);
    expect(hits[0]).toMatchObject({ source: "legacy", path: "api-gateway.md" });
    expect(hits.every((h) => h.source === "legacy")).toBe(true);
    expect(readdirSync(p.legacy)).not.toContain(".semantic-sidekick-index");
    expect(readdirSync(join(p.index, "sources")).some((d) => d.startsWith("legacy-"))).toBe(true);
  }, 300_000);

  it.fails("--source long-term searches every cold generation; hits carry source and historical; a locked generation is never written into", () => {
    const { r, hits } = search("request coalescing Skerry cache and the billing migration", "--source", "long-term", "--limit", "10");
    expect(r.status, r.stderr).toBe(0);
    expect(hits.every((h) => h.historical?.generation && h.source === `cold-${h.historical.generation}`)).toBe(true);
    expect(hits.map((h) => h.historical.generation)).toEqual(expect.arrayContaining([GEN_A]));
    for (const g of [GEN_A, GEN_B]) expect(readdirSync(join(p.coldRoot, g))).not.toContain(".semantic-sidekick-index");
  }, 300_000);

  it.fails("--source is repeatable, and `primary` names the default set", () => {
    const { r, hits } = search("how do services communicate and deploy", "--source", "primary", "--source", "legacy", "--limit", "10");
    expect(r.status, r.stderr).toBe(0);
    expect(new Set(hits.map((h) => h.source))).toEqual(new Set(["primary", "legacy"]));
  }, 300_000);

  it.fails("an unknown label fails with a clear message and never falls back to the default set", () => {
    const { r } = search("gateway", "--source", "nope");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown.*source.*nope/i);
  });

  it.fails("--reindex rebuilds a locked source's index (the explicit human action)", () => {
    const { r } = search("single entry point", "--source", "legacy", "--reindex");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/unknown option/i);
  }, 300_000);
});

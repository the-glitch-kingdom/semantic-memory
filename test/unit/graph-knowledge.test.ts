import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Indexer } from "../../src/core/indexer.js";
import { GraphBuilder } from "../../src/core/graph.js";
import { standaloneConfidence } from "../../src/core/confidence.js";
import { cleanupTempDir } from "../setup.js";

async function build(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "sp-gk-"));
  for (const [p, body] of Object.entries(files)) {
    await mkdir(join(dir, p, ".."), { recursive: true });
    await writeFile(join(dir, p), body);
  }
  const g = new GraphBuilder();
  g.buildFromDocuments(await new Indexer(dir).indexAll());
  return { g, dir };
}

describe("knowledge edges", () => {
  it("cites, supersedes and same-incident edges are typed and directed", async () => {
    const { g, dir } = await build({
      "playbooks/hang.md": "---\nsymptoms:\n  - text: it hangs\n    cites: [clock-drift]\n  - plain string\n---\n# Hang\n",
      "knowledge-base/facts/clock-drift.md": "# Clock drift\n",
      "guides/setup.md": "# Setup\n",
      "archive/guides/setup.md": "---\narchived_from: guides/setup.md\n---\n# Setup (old)\n",
      "knowledge-base/incidents/inc-1/timeline.md": "# Timeline\n",
      "knowledge-base/incidents/inc-1/postmortem.md": "# Post\n",
      "knowledge-base/incidents/inc-2/timeline.md": "# Other\n",
    });
    try {
      expect(g.forwardlinks("playbooks/hang.md", ["cites"]).map((n) => n.path)).toEqual(["knowledge-base/facts/clock-drift.md"]);
      expect(g.backlinks("knowledge-base/facts/clock-drift.md").map((n) => n.path)).toEqual(["playbooks/hang.md"]);
      expect(g.forwardlinks("guides/setup.md", ["supersedes"]).map((n) => n.path)).toEqual(["archive/guides/setup.md"]);
      expect(g.forwardlinks("guides/setup.md").map((n) => n.path)).toEqual([]); // supersedes is opt-in
      expect(g.forwardlinks("knowledge-base/incidents/inc-1/timeline.md").map((n) => n.path)).toEqual(["knowledge-base/incidents/inc-1/postmortem.md"]);
      expect(g.findPath("playbooks/hang.md", "knowledge-base/facts/clock-drift.md")).toHaveLength(2);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("searchGraph walks from semantic seeds, nearest first, with no degree tiebreak", async () => {
    const { g, dir } = await build({
      "seed.md": "# Seed\n[a](a.md) [b](b.md)\n",
      "a.md": "---\nload_priority: 5\n---\n# A\n[c](c.md)\n",
      "b.md": "---\nload_priority: 8\n---\n# B\n",
      "c.md": "# C\n",
      "hub.md": "# Hub\n[a](a.md) [b](b.md) [c](c.md) [seed](seed.md)\n",
    });
    try {
      expect(g.searchGraph(["seed.md"], 1).map((n) => n.path)).toEqual(["seed.md", "b.md", "a.md", "hub.md"]);
      expect(g.searchGraph(["seed.md"], 2, 20).map((n) => n.path).slice(0, 3)).toEqual(["seed.md", "b.md", "a.md"]);
      expect(g.searchGraph(["seed.md"], 2, 2)).toHaveLength(2);
      expect(g.searchGraph(["missing.md"])).toEqual([]);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});

describe("standaloneConfidence", () => {
  it("is cosine plus the lexical bonus, clamped, with no margin term", () => {
    expect(standaloneConfidence({ cosine: 0.55 })).toBe(0.55);
    expect(standaloneConfidence({ cosine: 0.55, lexical: true })).toBe(0.65);
    expect(standaloneConfidence({ cosine: 0.98, lexical: true })).toBe(1);
    expect(standaloneConfidence({})).toBe(0);
  });
});

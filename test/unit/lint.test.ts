import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lintVault, formatLintReport } from "../../src/core/lint.js";
import { createTempVault, cleanupTempDir } from "../setup.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

async function seed(dir: string, relPath: string, body: string) {
  await writeFile(join(dir, relPath), body, "utf-8");
}

describe("lintVault", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await createTempVault();
  });
  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("counts notes with no last_verified without adding findings", async () => {
    const base = await lintVault(tempDir);
    await seed(tempDir, "unverified.md", "---\ntitle: U\ntype: note\n---\nbody");
    await seed(tempDir, "verified.md", "---\ntitle: V\ntype: note\nlast_verified: 2999-01-01\n---\nbody");
    const after = await lintVault(tempDir);
    expect(after.counts.noLastVerified).toBe(base.counts.noLastVerified + 1);
    expect(after.byRule.stale).toHaveLength(base.byRule.stale.length);
  });

  it("returns findings grouped by rule", async () => {
    await seed(
      tempDir,
      "missing-fields.md",
      `---
type: decision
---
no required fields`
    );
    await seed(
      tempDir,
      "no-provenance.md",
      `---
title: lonely
type: note
status: active
---
body`
    );
    await seed(
      tempDir,
      "stale.md",
      `---
title: old
type: note
status: active
sources: [a]
last_verified: 2020-01-01
---
body`
    );
    const r = await lintVault(tempDir, { todayIso: "2026-04-21" });
    expect(r.byRule.schema_violations.length).toBeGreaterThan(0);
    expect(r.byRule.missing_provenance.length).toBeGreaterThan(0);
    expect(r.byRule.stale.length).toBeGreaterThan(0);
  });

  it("formatLintReport is non-empty when findings exist", async () => {
    await seed(tempDir, "bad.md", "---\ntype: note\n---\n");
    const r = await lintVault(tempDir);
    const text = formatLintReport(r);
    expect(text).toContain("bad.md");
  });

  it("flags broken wikilinks", async () => {
    await seed(
      tempDir,
      "alive.md",
      `---
title: alive
type: note
status: active
sources: [x]
---
Links to [[alive]] and [[ghost]] and [[also-ghost]].`
    );
    const r = await lintVault(tempDir, { pathGlob: "alive.md" });
    const broken = r.byRule.broken_links.map((f) => f.message);
    expect(broken.some((m) => m.includes("ghost"))).toBe(true);
    expect(broken.some((m) => m.includes("also-ghost"))).toBe(true);
    expect(broken.some((m) => m.includes("alive"))).toBe(false);
  });

  it("formatLintReport shows 'clean' when no findings", async () => {
    await seed(
      tempDir,
      "ok.md",
      `---
title: ok
type: note
status: active
sources: [x]
---
body`
    );
    // Scope to just our seeded file — other temp-vault fixtures may not conform to schema.
    const r = await lintVault(tempDir, { pathGlob: "ok.md" });
    const text = formatLintReport(r);
    expect(text).toContain("clean");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pathClassMultiplier,
  isExcludedPath,
  loadPathClassConfig,
  DEFAULT_PATH_CLASS_CONFIG,
  filterPathClass,
  indexExclude,
  type PathClassConfig,
} from "../../src/core/path-class.js";

describe("pathClassMultiplier", () => {
  const cfg = DEFAULT_PATH_CLASS_CONFIG;

  it("down-weights archive paths (including nested) and leaves others alone", () => {
    expect(pathClassMultiplier("archive/old.md", cfg)).toBe(0.3);
    expect(pathClassMultiplier("archive/pre-restructure/x.md", cfg)).toBe(0.3);
    expect(pathClassMultiplier("decisions/auth.md", cfg)).toBe(1);
    expect(pathClassMultiplier("readme.md", cfg)).toBe(1);
  });

  it("returns 1 when disabled", () => {
    expect(pathClassMultiplier("archive/old.md", { ...cfg, enabled: false })).toBe(1);
  });

  it("first matching rule wins", () => {
    const c: PathClassConfig = {
      enabled: true,
      rules: [
        { glob: "archive/keep/**", multiplier: 1.0 },
        { glob: "archive/**", multiplier: 0.3 },
      ],
    };
    expect(pathClassMultiplier("archive/keep/x.md", c)).toBe(1.0);
    expect(pathClassMultiplier("archive/other/x.md", c)).toBe(0.3);
  });
});

describe("loadPathClassConfig", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when no schema file", async () => {
    dir = await mkdtemp(join(tmpdir(), "pc-"));
    expect(loadPathClassConfig(dir)).toEqual(DEFAULT_PATH_CLASS_CONFIG);
  });

  it("reads a path_class override from vault.schema.yml", async () => {
    dir = await mkdtemp(join(tmpdir(), "pc-"));
    await writeFile(
      join(dir, "vault.schema.yml"),
      "path_class:\n  enabled: true\n  rules:\n    - glob: 'legacy/**'\n      multiplier: 0.1\n",
      "utf-8"
    );
    const c = loadPathClassConfig(dir);
    expect(c.rules).toEqual([{ glob: "legacy/**", multiplier: 0.1 }]);
    expect(pathClassMultiplier("legacy/x.md", c)).toBe(0.1);
    expect(pathClassMultiplier("archive/x.md", c)).toBe(1); // no longer matched
  });

  it("honors enabled:false in the schema", async () => {
    dir = await mkdtemp(join(tmpdir(), "pc-"));
    await writeFile(join(dir, "vault.schema.yml"), "path_class:\n  enabled: false\n", "utf-8");
    expect(loadPathClassConfig(dir).enabled).toBe(false);
  });

  it("falls back to defaults on malformed yaml or wrongly typed fields", async () => {
    dir = await mkdtemp(join(tmpdir(), "pc-"));
    await writeFile(join(dir, "vault.schema.yml"), "path_class: [unclosed\n  : :", "utf-8");
    expect(loadPathClassConfig(dir)).toEqual(DEFAULT_PATH_CLASS_CONFIG);
    await writeFile(join(dir, "vault.schema.yml"), "path_class:\n  rules: nope\n  exclude: 7\n", "utf-8");
    const c = loadPathClassConfig(dir);
    expect(c.rules).toEqual(DEFAULT_PATH_CLASS_CONFIG.rules);
    expect(c.exclude).toEqual(DEFAULT_PATH_CLASS_CONFIG.exclude);
  });

  it("matches archives at the top level, nested and under a dot-dir, and exclude [] opts out", () => {
    for (const p of ["archive/a.md", "security/archive/a.md", ".documentation/archive/a.md"]) {
      expect(isExcludedPath(p, DEFAULT_PATH_CLASS_CONFIG), p).toBe(true);
      expect(isExcludedPath(p, { ...DEFAULT_PATH_CLASS_CONFIG, exclude: [] }), p).toBe(false);
    }
  });
});

describe("results.exclude", () => {
  it("drops generated hubs and reports from results, even with path_class off", () => {
    const rs = [{ path: "guide.md" }, { path: "a/INDEX.md" }, { path: "reports/link-check-2026.md" }, { path: "reports/audit.md" }];
    const kept = (c: PathClassConfig) => filterPathClass(rs, c).map((r) => r.path);
    expect(kept(DEFAULT_PATH_CLASS_CONFIG)).toEqual(["guide.md", "reports/audit.md"]);
    expect(kept({ ...DEFAULT_PATH_CLASS_CONFIG, enabled: false })).toEqual(["guide.md", "reports/audit.md"]);
    expect(kept({ ...DEFAULT_PATH_CLASS_CONFIG, resultsExclude: [] })).toHaveLength(4);
  });

  it("is read from vault.schema.yml independently of path_class", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sp-pc-"));
    try {
      await writeFile(join(dir, "vault.schema.yml"), "results:\n  exclude:\n    - \"**/generated/**\"\n", "utf-8");
      const c = loadPathClassConfig(dir);
      expect(c.resultsExclude).toEqual(["**/generated/**"]);
      expect(c.exclude).toEqual(DEFAULT_PATH_CLASS_CONFIG.exclude);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("indexExclude is empty when path_class is disabled", () => {
    expect(indexExclude(DEFAULT_PATH_CLASS_CONFIG)).toEqual(["**/archive/**"]);
    expect(indexExclude({ ...DEFAULT_PATH_CLASS_CONFIG, enabled: false })).toEqual([]);
  });
});

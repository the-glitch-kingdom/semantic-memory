import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { featureState, featureOn, setSettingsEnv, setRepoConfig, describeFeature } from "../../src/core/features.js";

const CLI = join(resolve(fileURLToPath(new URL(".", import.meta.url)), "..", ".."), "dist", "cli", "index.js");

describe("feature switches (v1.7)", () => {
  let home: string;
  let repo: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "sm-features-home-"));
    repo = await mkdtemp(join(tmpdir(), "sm-features-repo-"));
    env = { HOME: home, PATH: process.env.PATH };
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it("both are off by default", () => {
    for (const f of ["skill_loop", "jev"] as const) {
      expect(featureState(f, repo, env)).toMatchObject({ on: false, why: "default" });
      expect(featureOn(f, repo, env)).toBe(false);
    }
  });

  it("env turns them on and off", () => {
    expect(featureState("skill_loop", repo, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "1" })).toMatchObject({ on: true, why: "env" });
    expect(featureState("skill_loop", repo, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "0" })).toMatchObject({ on: false, why: "env" });
    expect(featureState("skill_loop", repo, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "" })).toMatchObject({ on: false, why: "default" });
  });

  it("the repo override beats the global switch for the skill loop, both ways", () => {
    setRepoConfig(repo, "skill_loop", "off");
    expect(featureState("skill_loop", repo, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "1" })).toMatchObject({ on: false, why: "repo" });
    setRepoConfig(repo, "skill_loop", "on");
    expect(featureState("skill_loop", repo, env)).toMatchObject({ on: true, why: "repo" });
    setRepoConfig(repo, "skill_loop", undefined);
    expect(featureState("skill_loop", repo, env)).toMatchObject({ on: false, why: "default" });
  });

  it("jev mode has no repo override", () => {
    setRepoConfig(repo, "jev", "on");
    expect(featureState("jev", repo, env).on).toBe(false);
  });

  it("jev on but unavailable names the reason, and featureOn is false", async () => {
    const jevEnv = { ...env, SEMANTIC_MEMORY_JEV: "1", JEV_LOOP_DIR: join(home, "nope") };
    const s = featureState("jev", repo, jevEnv);
    expect(s).toMatchObject({ on: true, available: false });
    expect(s.reason).toContain("router.py");
    expect(featureOn("jev", repo, jevEnv)).toBe(false);
    expect(describeFeature(s)).toContain("on but unavailable");

    const dir = join(home, "jev-loop");
    await mkdir(dir);
    await writeFile(join(dir, "router.py"), "");
    const noKey = featureState("jev", repo, { ...jevEnv, JEV_LOOP_DIR: dir });
    expect(noKey.reason).toContain("TYPESAFE_API_KEY");

    // the key in settings.json counts (cron-style), and is never returned
    await mkdir(join(home, ".claude"));
    await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ env: { TYPESAFE_API_KEY: "fake-key-value" } }));
    const ok = featureState("jev", repo, { ...jevEnv, JEV_LOOP_DIR: dir });
    expect(ok).toMatchObject({ on: true, available: true });
    expect(JSON.stringify(ok)).not.toContain("fake-key-value");

    const noPython = featureState("jev", repo, { ...jevEnv, JEV_LOOP_DIR: dir, PATH: home });
    expect(noPython.reason).toContain("python3");
  });

  describe("settings.json edits", () => {
    const settings = () => join(home, ".claude", "settings.json");

    it("adds only its key, keeps the others and the indent, writes a .bak", async () => {
      await mkdir(join(home, ".claude"));
      const before = JSON.stringify({ model: "opus", env: { OTHER: "x" }, hooks: { Stop: [] } }, null, 4) + "\n";
      await writeFile(settings(), before);
      const r = setSettingsEnv("SEMANTIC_MEMORY_SKILL_LOOP", "1", env);
      const after = JSON.parse(await readFile(settings(), "utf8"));
      expect(after).toEqual({ model: "opus", env: { OTHER: "x", SEMANTIC_MEMORY_SKILL_LOOP: "1" }, hooks: { Stop: [] } });
      expect(await readFile(settings(), "utf8")).toContain('\n    "model"');
      expect(await readFile(r.backup!, "utf8")).toBe(before);
      setSettingsEnv("SEMANTIC_MEMORY_SKILL_LOOP", undefined, env);
      expect(JSON.parse(await readFile(settings(), "utf8")).env).toEqual({ OTHER: "x" });
    });

    it("works when the file or the env block is missing", async () => {
      setSettingsEnv("SEMANTIC_MEMORY_JEV", "1", env);
      expect(JSON.parse(await readFile(settings(), "utf8"))).toEqual({ env: { SEMANTIC_MEMORY_JEV: "1" } });
      await writeFile(settings(), JSON.stringify({ model: "x" }));
      setSettingsEnv("SEMANTIC_MEMORY_JEV", "1", env);
      expect(JSON.parse(await readFile(settings(), "utf8"))).toEqual({ model: "x", env: { SEMANTIC_MEMORY_JEV: "1" } });
    });

    it("refuses invalid JSON without writing", async () => {
      await mkdir(join(home, ".claude"));
      await writeFile(settings(), "{ not json");
      expect(() => setSettingsEnv("SEMANTIC_MEMORY_JEV", "1", env)).toThrow(/not valid JSON/);
      expect(await readFile(settings(), "utf8")).toBe("{ not json");
      expect(existsSync(settings() + ".bak")).toBe(false);
    });
  });

  it("CLI on / off / status round-trip, --repo override", () => {
    const run = (...args: string[]) => {
      const r = spawnSync("node", [CLI, ...args], { cwd: repo, encoding: "utf8", env: { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "" } });
      return { code: r.status, out: r.stdout + r.stderr };
    };
    expect(run("skill-loop", "status").out).toContain("skill loop: off [default]");
    expect(run("skill-loop", "on").out).toContain("SEMANTIC_MEMORY_SKILL_LOOP=1");
    expect(run("skill-loop", "off", "--repo").out).toContain("now: skill loop: off [repo override");
    expect(run("skill-loop", "on", "--repo", "--clear").out).toContain("cleared");
    expect(run("jev-mode", "on").code).toBe(0);
    expect(run("jev-mode", "off").out).toContain("removed SEMANTIC_MEMORY_JEV");
  });
});

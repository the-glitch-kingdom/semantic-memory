import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoState, autoOn, setRepoConfig } from "../../src/core/features.js";
import { parseSkill, renderSkill, deadRefs, duplicateOf, overlap, skillWords, type SkillLoopMeta } from "../../src/core/skill-schema.js";

const META: SkillLoopMeta = {
  schema: 1,
  scope: "project",
  status: "active",
  pinned: false,
  triggers: ["Exit code 144"],
  applies_to: { paths: ["scripts"], commands: ["pkill"] },
  provenance: { sessions: ["s1"], failures: ["f1"], corrections: [] },
  cites: [],
  supersedes: [],
};
const skill = (name: string, description: string, body = "## Steps\n1. x\n", meta: Partial<SkillLoopMeta> = {}) =>
  parseSkill(renderSkill({ name, description, meta: { ...META, ...meta }, body }));

describe("auto mode switch (v1.8)", () => {
  let repo: string;
  const LOOP = { SEMANTIC_MEMORY_SKILL_LOOP: "1" };
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-auto-repo-"));
  });
  afterEach(() => rm(repo, { recursive: true, force: true }));

  it("is off by default, and env turns it on", () => {
    expect(autoState(repo, {})).toEqual({ on: false, why: "default" });
    expect(autoState(repo, { SEMANTIC_MEMORY_SKILL_LOOP_AUTO: "1" })).toEqual({ on: true, why: "env" });
    expect(autoOn(repo, { ...LOOP, SEMANTIC_MEMORY_SKILL_LOOP_AUTO: "1" })).toBe(true);
  });

  it("has no effect while the skill loop is off", () => {
    expect(autoOn(repo, { SEMANTIC_MEMORY_SKILL_LOOP_AUTO: "1" })).toBe(false);
  });

  it("the repo key beats the env switch, both ways", () => {
    setRepoConfig(repo, "skill_loop_auto", "off");
    expect(autoOn(repo, { ...LOOP, SEMANTIC_MEMORY_SKILL_LOOP_AUTO: "1" })).toBe(false);
    setRepoConfig(repo, "skill_loop_auto", "on");
    expect(autoState(repo, {})).toEqual({ on: true, why: "repo" });
    expect(autoOn(repo, LOOP)).toBe(true);
  });
});

describe("dedup (v1.8)", () => {
  const a = skill("stop-vite-dev-server", "Stop the Vite dev server without killing your shell. Use when pkill exits 144.");
  it("same procedure in other words is a duplicate; an unrelated skill is not", () => {
    const b = skill("kill-vite-dev-server", "Kill the Vite dev server without killing your shell. Use when pkill -f exits 144.");
    const c = skill("rotate-npm-token", "Rotate the npm publish token. Use when npm publish fails with E401.", "## Steps\n1. x\n", { triggers: ["E401"], applies_to: { paths: [], commands: ["npm"] } });
    expect(overlap(skillWords(a), skillWords(b))).toBeGreaterThanOrEqual(0.5);
    expect(duplicateOf(b, [{ name: a.name, skill: a }])?.other.name).toBe("stop-vite-dev-server");
    expect(duplicateOf(c, [{ name: a.name, skill: a }])).toBeNull();
  });
  it("the same name is always a duplicate", () => {
    const d = skill("stop-vite-dev-server", "Something else entirely about databases and migrations.", "## Steps\n1. x\n", { triggers: [], applies_to: { paths: [], commands: [] } });
    expect(duplicateOf(d, [{ name: a.name, skill: a }])?.overlap).toBe(1);
  });
});

describe("dead references (v1.8)", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-dead-repo-"));
    await mkdir(join(repo, "scripts"));
    await writeFile(join(repo, "scripts", "dev.sh"), "x");
  });
  afterEach(() => rm(repo, { recursive: true, force: true }));

  it("finds missing applies_to paths and missing repo paths in code, nothing else", () => {
    const body = [
      "## Steps",
      "1. Run `scripts/dev.sh` then `scripts/old-restart.sh`.",
      "2. See `scripts/dev.sh:12` and `./scripts/gone.py:3:1`.",
      "```bash",
      "bash scripts/also-gone.sh --flag && git push origin/main",
      "curl https://example.com/a/b",
      "```",
      "3. Not paths: `owner/repo`, `@scope/pkg`, `text/html`, `src/**/*.ts`, `~/x/y`, `/etc/hosts`, `<dir>/x`.",
    ].join("\n");
    const s = skill("x-skill", "d", body, { applies_to: { paths: ["scripts", "removed-dir"], commands: [] } });
    expect(deadRefs(s, [repo]).sort()).toEqual(["removed-dir", "scripts/also-gone.sh", "scripts/gone.py", "scripts/old-restart.sh"]);
  });

  it("a skill with every path present has none", () => {
    expect(deadRefs(skill("y-skill", "d", "## Steps\n1. `scripts/dev.sh`\n"), [repo])).toEqual([]);
  });
});

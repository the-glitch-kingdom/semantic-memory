import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkill, renderSkill, lintSkill, lintSkills, findSkills, type SkillLoopMeta } from "../../src/core/skill-schema.js";
import { lintVault } from "../../src/core/lint.js";

const j = (...p: string[]) => p.join("");
const FAKE_SECRET = j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");

const META: SkillLoopMeta = {
  schema: 1,
  scope: "project",
  status: "active",
  pinned: false,
  triggers: ["Exit code 144"],
  applies_to: { paths: ["scripts"], commands: ["pkill"] },
  provenance: { sessions: ["s1"], failures: ["f1"], corrections: [] },
  cites: ["pkill-self-match"],
  supersedes: [],
};
const BODY = "## When to use\nA dev server restart fails with exit 144.\n\n## Steps\n1. Use pgrep '[v]ite'.\n\n## Pitfalls\n- pkill -f matches its own shell (fact pkill-self-match).\n\n## Verify\n`pgrep -f '[v]ite'` prints nothing.\n";
const good = (over: Partial<{ name: string; description: string; meta: SkillLoopMeta; body: string }> = {}) =>
  renderSkill({
    name: "restart-dev-server",
    description: "Restart the Vite dev server without killing your own shell. Use when pkill exits 144 or the dev server will not stop.",
    meta: META,
    body: BODY,
    ...over,
  });

describe("skill format", () => {
  let root: string;
  let home: string;
  const ctx = () => ({ projectRoot: root, facts: new Set(["pkill-self-match"]), others: findSkills(root, { home }) });
  const rules = (raw: string, dir = "restart-dev-server") => lintSkill(join(root, "x", "SKILL.md"), raw, ctx(), dir).map((f) => `${f.severity}:${f.rule}`);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sm-skill-"));
    home = await mkdtemp(join(tmpdir(), "sm-skill-home-"));
    await mkdir(join(root, "scripts"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("renders and parses back the same skill, deterministically", () => {
    const raw = good();
    const s = parseSkill(raw);
    expect(s.meta).toEqual(META);
    expect(s.sections).toEqual(["When to use", "Steps", "Pitfalls", "Verify"]);
    expect(s.frontmatter.metadata).toEqual({ generated_by: "semantic-memory" });
    expect(renderSkill({ name: s.name, description: s.description, meta: s.meta!, body: s.body })).toBe(raw);
  });

  it("a valid skill passes", () => {
    expect(rules(good())).toEqual([]);
  });

  it("each rule fails on its own bad example", () => {
    expect(rules(good({ meta: { ...META, provenance: { sessions: [], failures: [], corrections: [] } } }))).toEqual(["error:provenance"]);
    expect(rules(good({ description: "Helps with the dev server." }))).toEqual(expect.arrayContaining(["error:description", "warn:description"]));
    expect(rules(good({ description: "Restart the dev server cleanly with pgrep patterns and a pid file always." }))).toEqual(["error:description"]);
    expect(rules(good({ body: BODY.replace("## Verify", "## Check") }))).toEqual(["error:sections"]);
    expect(rules(good({ meta: { ...META, cites: ["no-such-fact"] } }))).toEqual(["error:cites"]);
    expect(rules(good({ meta: { ...META, applies_to: { paths: ["nope/"], commands: [] } } }))).toEqual(["error:applies_to"]);
    expect(rules(good({ meta: { ...META, scope: "directory", applies_to: { paths: [], commands: [] } } }))).toEqual(["error:applies_to"]);
    expect(rules(good({ body: BODY + `\nUse token ${FAKE_SECRET}\n` }))).toEqual(["error:secrets"]);
    expect(rules(good({ name: "Bad Name" }), "Bad Name")).toEqual(["error:name"]);
    expect(rules(good(), "other-folder")).toEqual(["error:name"]);
    expect(rules(good().replace("schema: 1", "schema: 2"))).toEqual(["error:skill_loop"]);
    expect(rules("---\nname: restart-dev-server\ndescription: x\n---\nbody")).toContain("error:skill_loop");
  });

  it("a global skill's cites are not checked against this repo's facts", () => {
    expect(rules(good({ meta: { ...META, scope: "global", cites: ["elsewhere"] } }))).toEqual([]);
  });

  it("a learned skill may not take the name of a skill it did not write", async () => {
    await mkdir(join(home, ".claude", "skills", "restart-dev-server"), { recursive: true });
    await writeFile(join(home, ".claude", "skills", "restart-dev-server", "SKILL.md"), "---\nname: restart-dev-server\ndescription: the user's own\n---\nhi\n");
    expect(rules(good())).toEqual(["error:name_clash"]);
  });

  it("finds project, directory and global skills; lints only learned ones", async () => {
    const put = async (dir: string, raw: string) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), raw);
    };
    await put(join(root, ".claude", "skills", "restart-dev-server"), good());
    await put(join(root, "apps", "web", ".claude", "skills", "web-only"), good({ name: "web-only", meta: { ...META, scope: "directory", cites: [] } }));
    await put(join(root, ".claude", "skills", "hand-written"), "---\nname: hand-written\ndescription: mine\n---\n");
    await put(join(root, "node_modules", "x", ".claude", "skills", "vendored"), good({ name: "vendored" }));
    const found = findSkills(root, { home });
    expect(found.map((f) => `${f.scope}:${f.skill.name}:${f.learned}`).sort()).toEqual([
      "directory:web-only:true",
      "project:hand-written:false",
      "project:restart-dev-server:true",
    ]);
    const r = lintSkills(root, { home });
    expect(r.files).toBe(2);
    // the project skill cites a fact this temp repo does not have
    expect(r.findings.map((f) => f.rule)).toEqual(["cites"]);
  });

  it("lint_vault({checks: ['skills']}) reports through the vault linter", async () => {
    await mkdir(join(root, ".claude", ".vault"), { recursive: true });
    await mkdir(join(root, ".claude", "skills", "restart-dev-server"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "restart-dev-server", "SKILL.md"), good({ meta: { ...META, provenance: { sessions: [], failures: [], corrections: [] }, cites: [] } }));
    const report = await lintVault(join(root, ".claude", ".vault"), { checkSkills: true });
    expect(report.byRule.skills?.map((f) => f.message)).toEqual([expect.stringContaining("provenance")]);
    expect(report.byRule.skills?.[0].path).toBe(join(".claude", "skills", "restart-dev-server", "SKILL.md"));
  });
});

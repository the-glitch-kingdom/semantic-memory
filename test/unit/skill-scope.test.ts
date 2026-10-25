import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideScope, repoReferences, indexSkill, readIndex, promotionPeers, sameLesson, isPrivateRepo, skillIndexPath } from "../../src/core/skill-scope.js";
import { materializeDraft, listDrafts } from "../../src/core/skill-review.js";
import { fakeJevLoop } from "../jev-fake.js";

describe("skill scope (v1.7)", () => {
  let repo: string;
  let state: string;
  let jev: { dir: string; env: NodeJS.ProcessEnv };
  let env: NodeJS.ProcessEnv;
  const calls = async () => (await readFile(join(jev.dir, "calls.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-scope-repo-"));
    state = await mkdtemp(join(tmpdir(), "sm-scope-state-"));
    jev = await fakeJevLoop();
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "scripts"));
    await writeFile(join(repo, "scripts", "release.sh"), "");
    await mkdir(join(repo, "apps", "web", "src"), { recursive: true });
    await writeFile(join(repo, "apps", "web", "package.json"), "{}");
    await writeFile(join(repo, "apps", "web", "src", "main.ts"), "");
    env = { ...process.env, ...jev.env, PATH: process.env.PATH, SEMANTIC_MEMORY_STATE_HOME: state, SEMANTIC_MEMORY_JEV: "", SEMANTIC_MEMORY_PRIVATE_PATHS: "" };
  });
  afterEach(async () => {
    for (const d of [repo, state, jev.dir]) await rm(d, { recursive: true, force: true });
  });

  const draft = (body: string, paths: string[] = []) => ({ name: "release-checklist", description: "Cut a release. Use when releasing.", body, applies_to: { paths } });

  it("finds the repo paths a draft names", () => {
    expect(repoReferences(repo, "run `scripts/release.sh` then edit apps/web/src/main.ts and /etc/hosts and nope/x.ts").sort()).toEqual(["apps/web/src/main.ts", "scripts/release.sh"]);
  });

  it("repo paths → project; every path under one package subdir → directory", async () => {
    expect(await decideScope(repo, draft("Run scripts/release.sh"), env)).toMatchObject({ scope: "project", globalCandidate: false });
    expect(await decideScope(repo, draft("Edit apps/web/src/main.ts", ["apps/web"]), env)).toMatchObject({ scope: "directory", directory: "apps/web" });
    // scripts/ is a plain folder, not a unit of its own: still project
    expect(await decideScope(repo, draft("Run scripts/release.sh", ["scripts"]), env)).toMatchObject({ scope: "project" });
  });

  it("names nothing: jev off → project, no Jev call", async () => {
    expect(await decideScope(repo, draft("Use git rebase --onto to move a branch."), env)).toMatchObject({ scope: "project", globalCandidate: false });
    expect(await calls()).toEqual([]);
  });

  it("names nothing, jev on and Jev says general → still project, only a global candidate", async () => {
    await writeFile(join(jev.dir, "mode"), "yes");
    const d = await decideScope(repo, draft("Use git rebase --onto to move a branch."), { ...env, SEMANTIC_MEMORY_JEV: "1" });
    expect(d).toMatchObject({ scope: "project", globalCandidate: true });
    expect(JSON.parse((await calls())[0]).caller).toBe("semantic-memory-skill-loop");
    await writeFile(join(jev.dir, "mode"), "no");
    expect(await decideScope(repo, draft("Use git rebase."), { ...env, SEMANTIC_MEMORY_JEV: "1" })).toMatchObject({ globalCandidate: false });
  });

  it("a private repo stays project, is never indexed and never asks Jev", async () => {
    const priv = await mkdtemp(join(tmpdir(), "sm-private-"));
    try {
      await writeFile(join(jev.dir, "mode"), "yes");
      const e = { ...env, SEMANTIC_MEMORY_JEV: "1", SEMANTIC_MEMORY_PRIVATE_PATHS: priv };
      expect(isPrivateRepo(priv, e)).toBe(true);
      expect(await decideScope(priv, draft("Use git rebase."), e)).toMatchObject({ scope: "project", globalCandidate: false });
      expect(await calls()).toEqual([]);
      indexSkill({ repo: priv, name: "release-checklist", path: "x", status: "active" }, e);
      expect(existsSync(skillIndexPath(e))).toBe(false);
      expect(promotionPeers(priv, "release-checklist", e)).toEqual([]);
    } finally {
      await rm(priv, { recursive: true, force: true });
    }
  });

  it("same lesson in two repos → the second repo's draft carries a promotion proposal", async () => {
    expect(sameLesson("release-checklist", "release-checklist")).toBe(true);
    expect(sameLesson("npm-release-checklist", "release-checklist-npm")).toBe(true);
    expect(sameLesson("release-checklist", "restart-dev-server")).toBe(false);
    indexSkill({ repo: "/other/repo", name: "release-checklist", path: "/other/repo/.claude/skills/release-checklist/SKILL.md", status: "active" }, env);
    const job = { session_id: "s1", repo, transcript_path: null, reason: "x", ts: "", evidence: { failures: ["f1"], corrections: 0, skills_used: [], tool_calls: 0 } };
    const body = "## When to use\nReleasing.\n\n## Steps\n1. Run scripts/release.sh\n\n## Pitfalls\n- Missed a field (failure f1).\n\n## Verify\n`true`\n";
    const r = await materializeDraft(repo, job, { kind: "new", name: "release-checklist", description: "Cut a release with every version field bumped. Use when releasing.", scope: "global", body, provenance: { failures: ["f1"] } }, [], undefined, env);
    expect(r.id).toBeDefined();
    const [d] = listDrafts(repo);
    expect(d.record.scope).toBe("project"); // the reviewer asked for global: never trusted
    expect(d.record.promotion).toEqual([{ repo: "/other/repo", path: "/other/repo/.claude/skills/release-checklist/SKILL.md" }]);
    expect(readIndex(env).map((e) => e.repo).sort()).toEqual(["/other/repo", repo].sort());
  });
});

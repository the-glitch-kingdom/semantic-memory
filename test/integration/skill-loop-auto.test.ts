import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidence } from "../../src/core/skill-evidence.js";
import { buildBrief, reviewSession, listDrafts, materializeDraft } from "../../src/core/skill-review.js";
import { findSkills, renderSkill, type SkillLoopMeta } from "../../src/core/skill-schema.js";
import type { ReviewJob } from "../../src/core/skill-queue.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FAKE_CLAUDE = join(ROOT, "test", "bin", "claude");

const BODY = "## When to use\nVite will not stop.\n\n## Steps\n1. Run `scripts/dev.sh stop`.\n2. Then `scripts/old-stop.sh`.\n\n## Pitfalls\n- pkill -f matched its own shell (failure t1).\n\n## Verify\n```\n! pgrep -f '[v]ite'\n```\n";
const META: SkillLoopMeta = { schema: 1, scope: "project", status: "active", pinned: false, triggers: ["Exit code 144"], applies_to: { paths: ["scripts"], commands: ["pgrep"] }, provenance: { sessions: ["s0"], failures: ["t0"], corrections: [] }, cites: [], supersedes: [] };
const draft = (over: Record<string, unknown> = {}) => ({
  kind: "new",
  name: "rotate-npm-token",
  description: "Rotate the npm publish token and re-login. Use when npm publish fails with E401.",
  scope: "project",
  applies_to: { paths: ["scripts"], commands: ["npm"] },
  triggers: ["E401"],
  provenance: { sessions: ["s1"], failures: ["t1"], corrections: [] },
  cites: [],
  body: "## When to use\nnpm publish says E401.\n\n## Steps\n1. `npm login`\n\n## Pitfalls\n- the token expired (failure t1).\n\n## Verify\n```\nnpm whoami\n```\n",
  ...over,
});

describe("skill loop v1.8: the reviewer judges the skills too (fake claude)", () => {
  let repo: string;
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let job: ReviewJob;
  const answer = (obj: unknown) => writeFile(join(tmp, "rules.json"), JSON.stringify([{ match: "*", result: JSON.stringify(obj) }]));
  const put = async (name: string, raw: string) => {
    await mkdir(join(repo, ".claude", "skills", name), { recursive: true });
    await writeFile(join(repo, ".claude", "skills", name, "SKILL.md"), raw);
  };
  const learned = (name: string, over: Partial<SkillLoopMeta> = {}, description = "Stop the Vite dev server without killing your shell. Use when pkill -f exits 144.") =>
    put(name, renderSkill({ name, description, meta: { ...META, ...over }, body: BODY }));

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-auto-repo-"));
    tmp = await mkdtemp(join(tmpdir(), "sm-auto-tmp-"));
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "scripts"));
    await writeFile(join(repo, "scripts", "dev.sh"), "npm run dev\n");
    env = { ...process.env, HOME: tmp, SEMANTIC_MEMORY_STATE_HOME: join(tmp, "state"), SEMANTIC_MEMORY_CLAUDE_BIN: FAKE_CLAUDE, SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(tmp, "slots"), FAKE_CLAUDE_LOG: join(tmp, "log.jsonl"), FAKE_CLAUDE_RULES: join(tmp, "rules.json") };
    appendEvidence(repo, "failures", { session_id: "s1", id: "t1", tool: "Bash", command: "pkill -f vite", error: "Exit code 144" });
    const transcript = join(tmp, "s1.jsonl");
    await writeFile(
      transcript,
      [
        { type: "user", message: { content: "the vite dev server will not stop, pkill exits 144" } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pkill -f vite" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 144" }] } },
      ].map((l) => JSON.stringify(l)).join("\n"),
    );
    job = { session_id: "s1", repo, transcript_path: transcript, reason: "1 failure(s)", ts: new Date().toISOString(), evidence: { failures: ["t1"], corrections: 0, skills_used: [], tool_calls: 0 } };
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("the brief shows related skills in full with their dead references; unrelated ones only listed", async () => {
    await learned("stop-vite-dev-server");
    await put("rotate-keys", "---\nname: rotate-keys\ndescription: Rotate cloud database credentials quarterly.\n---\nbody of rotate-keys\n");
    const brief = buildBrief(job, findSkills(repo, { home: tmp }));
    expect(brief).toContain("### stop-vite-dev-server (project; learned)");
    expect(brief).toContain("dead references (paths it names that do not exist here): scripts/old-stop.sh");
    expect(brief).toContain("1. Run `scripts/dev.sh stop`.");
    expect(brief).toContain("- rotate-keys (project; learned: false)");
    expect(brief).not.toContain("body of rotate-keys");
  });

  it("a maintenance brief has no session, just the skills to check", async () => {
    await learned("stop-vite-dev-server");
    const path = join(repo, ".claude", "skills", "stop-vite-dev-server", "SKILL.md");
    const brief = buildBrief({ ...job, session_id: "maintenance-1", kind: "maintenance", skills: [path], transcript_path: null, reason: "dead references" }, findSkills(repo, { home: tmp }));
    expect(brief).toContain("# Skill maintenance maintenance-1 (no session)");
    expect(brief).toContain("## Skills to check");
    expect(brief).toContain("scripts/old-stop.sh");
    expect(brief).not.toContain("## Timeline");
  });

  it("dedup: a new skill duplicating a landed skill or a waiting draft is rejected", async () => {
    await learned("stop-vite-dev-server");
    const dupe = draft({ name: "kill-vite-dev-server", description: "Kill the Vite dev server without killing your shell. Use when pkill -f exits 144.", triggers: ["Exit code 144"], applies_to: { paths: ["scripts"], commands: ["pgrep"] } });
    await answer({ drafts: [dupe] });
    let out = await reviewSession(job, { env });
    expect(out.drafts).toEqual([]);
    expect(out.rejected[0].reason).toContain('duplicate of "stop-vite-dev-server"');
    // a waiting draft counts too
    await answer({ drafts: [draft()] });
    expect((await reviewSession(job, { env })).drafts).toHaveLength(1);
    await answer({ drafts: [draft({ name: "renew-npm-token" })] });
    out = await reviewSession(job, { env });
    expect(out.rejected[0].reason).toContain('duplicate of "rotate-npm-token (a waiting draft)"');
  });

  it("archive: a learned skill becomes an archive draft; pinned or without a why is rejected", async () => {
    await learned("stop-vite-dev-server");
    await learned("pinned-one", { pinned: true }, "Pinned skill about something. Use when pinned.");
    await answer({ drafts: [{ kind: "archive", target: "stop-vite-dev-server", why: "scripts/old-stop.sh is gone" }, { kind: "archive", target: "pinned-one", why: "x" }, { kind: "archive", target: "stop-vite-dev-server" }] });
    const out = await reviewSession(job, { env });
    expect(out.drafts).toHaveLength(1);
    expect(out.rejected.map((r) => r.reason).join(" | ")).toMatch(/pinned.*\| .*without a why/);
    expect(listDrafts(repo)[0].record).toMatchObject({ kind: "archive", name: "stop-vite-dev-server", why: "scripts/old-stop.sh is gone" });
  });

  it("hand-written skills only get suggestions; a linked one names its real file", async () => {
    await mkdir(join(tmp, "pkg", "node_modules", "lib", "skills", "theirs"), { recursive: true });
    await writeFile(join(tmp, "pkg", "node_modules", "lib", "skills", "theirs", "SKILL.md"), "---\nname: theirs\ndescription: a package skill\n---\nold\n");
    await mkdir(join(repo, ".claude", "skills"), { recursive: true });
    await symlink(join(tmp, "pkg", "node_modules", "lib", "skills", "theirs"), join(repo, ".claude", "skills", "theirs"));
    await answer({ drafts: [{ kind: "patch", target: "theirs", name: "theirs", description: "x", body: "new body" }] });
    const out = await reviewSession(job, { env });
    expect(out.drafts).toHaveLength(1);
    const [s] = listDrafts(repo);
    expect(s.record).toMatchObject({ kind: "suggest", action: "patch", real_path: join(tmp, "pkg", "node_modules", "lib", "skills", "theirs", "SKILL.md") });
    expect(s.record.warnings[0]).toContain("inside a package");
    expect(readFileSync(join(repo, ".claude", "skills", "theirs", "SKILL.md"), "utf8")).toContain("old");
  });

  it("a maintenance job needs no failure or correction; a session job still does", async () => {
    await learned("stop-vite-dev-server");
    const skills = findSkills(repo, { home: tmp });
    const patch = { kind: "patch" as const, target: "stop-vite-dev-server", name: "stop-vite-dev-server", description: "Stop the Vite dev server. Use when pkill -f exits 144.", scope: "project", body: BODY.replace("2. Then `scripts/old-stop.sh`.\n", ""), provenance: {} };
    const quiet = { ...job, evidence: { ...job.evidence, failures: [] } };
    expect((await materializeDraft(repo, quiet, patch, skills, undefined, env)).rejected).toContain("no failure or correction");
    const r = await materializeDraft(repo, { ...quiet, kind: "maintenance", session_id: "maintenance-1" }, patch, skills, undefined, env);
    expect(r.id).toBeTruthy();
    expect(existsSync(join(repo, ".claude", ".semantic-memory", "skill-drafts", r.id!, "SKILL.md"))).toBe(true);
  });
});

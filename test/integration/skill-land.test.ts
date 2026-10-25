import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeDraft, listDrafts } from "../../src/core/skill-review.js";
import { approveDraft, rejectDraft, describeDrafts } from "../../src/core/skill-land.js";
import { readLedger, rollback } from "../../src/core/skill-ledger.js";
import { indexSkill } from "../../src/core/skill-scope.js";
import { renderSkill } from "../../src/core/skill-schema.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const BODY = "## When to use\nReleasing.\n\n## Steps\n1. Run scripts/release.sh\n\n## Pitfalls\n- Missed a field (failure f1).\n\n## Verify\n`true`\n";

describe("landing skill drafts (v1.7)", () => {
  let repo: string, other: string, home: string, env: NodeJS.ProcessEnv;
  const job = { session_id: "s1", repo: "", transcript_path: null, reason: "x", ts: "", evidence: { failures: ["f1"], corrections: 0, skills_used: [], tool_calls: 0 } };
  const make = async (over: Record<string, unknown> = {}) => {
    const r = await materializeDraft(repo, { ...job, repo }, { kind: "new", name: "release-checklist", description: "Cut a release with every version field bumped. Use when releasing.", scope: "project", body: BODY, provenance: { failures: ["f1"] }, ...over } as any, [], undefined, env);
    if (!r.id) throw new Error(r.rejected);
    return r.id;
  };
  const dest = () => join(repo, ".claude", "skills", "release-checklist", "SKILL.md");

  beforeEach(async () => {
    [repo, other, home] = await Promise.all(["sm-land-repo-", "sm-land-other-", "sm-land-home-"].map((p) => mkdtemp(join(tmpdir(), p))));
    for (const r of [repo, other]) {
      await mkdir(join(r, ".git"));
      await mkdir(join(r, "scripts"));
      await writeFile(join(r, "scripts", "release.sh"), "");
    }
    env = { ...process.env, HOME: home, SEMANTIC_MEMORY_STATE_HOME: join(home, ".semantic-memory"), SEMANTIC_MEMORY_JEV: "" };
  });
  afterEach(async () => {
    for (const d of [repo, other, home]) await rm(d, { recursive: true, force: true });
  });

  it("approve writes the active skill and one ledger entry; the draft is gone", async () => {
    const id = await make();
    const e = approveDraft(repo, id, { env });
    expect(e).toMatchObject({ action: "land", actor: "user", skill: "release-checklist", files: [{ path: dest(), before: null }] });
    const text = await readFile(dest(), "utf8");
    expect(text).toContain("status: active");
    expect(listDrafts(repo)).toEqual([]);
    expect(readLedger(repo)).toHaveLength(1);
    expect(() => approveDraft(repo, id, { env })).toThrow(/no draft/);
  });

  it("once evals ran, a draft the gate did not adopt needs --override (ledgered)", async () => {
    const id = await make();
    const f = join(listDrafts(repo)[0].dir, "draft.json");
    const rec = JSON.parse(await readFile(f, "utf8"));
    await writeFile(f, JSON.stringify({ ...rec, evals: { gate: { verdict: "keep-draft", reasons: ["task pass 100% with the skill does not beat 100% without"] } } }));
    expect(() => approveDraft(repo, id, { env })).toThrow(/eval gate said keep-draft/);
    expect(approveDraft(repo, id, { env, override: "docs already cover it; keep for speed" }).why).toContain("overridden: docs already cover it");
  });

  it("reject drops the draft and ledgers it; nothing lands", async () => {
    const id = await make();
    expect(rejectDraft(repo, id).action).toBe("reject");
    expect(listDrafts(repo)).toEqual([]);
    expect(existsSync(dest())).toBe(false);
  });

  it("global always waits: no promotion → --promote refused; a global candidate still lands as project", async () => {
    const id = await make();
    expect(() => approveDraft(repo, id, { promote: true, env })).toThrow(/no promotion/);
    approveDraft(repo, id, { env });
    expect(existsSync(join(home, ".claude", "skills", "release-checklist"))).toBe(false);
  });

  it("a promotion lands one global skill and archives the other repo's landed copy (ledgered there)", async () => {
    const peer = join(other, ".claude", "skills", "release-checklist", "SKILL.md");
    const meta = { schema: 1 as const, scope: "project" as const, status: "active" as const, pinned: false, triggers: [], applies_to: { paths: ["scripts"], commands: [] }, provenance: { sessions: ["s0"], failures: ["f0"], corrections: [] }, cites: [], supersedes: [] };
    await mkdir(join(other, ".claude", "skills", "release-checklist"), { recursive: true });
    await writeFile(peer, renderSkill({ name: "release-checklist", description: "Cut a release. Use when releasing.", meta, body: BODY }));
    indexSkill({ repo: other, name: "release-checklist", path: peer, status: "active" }, env);
    const id = await make();
    expect(describeDrafts(repo, env)[0].promotion).toEqual([{ repo: other, path: peer }]);
    const e = approveDraft(repo, id, { promote: true, env });
    const global = join(home, ".claude", "skills", "release-checklist", "SKILL.md");
    expect(e.action).toBe("promote");
    expect(await readFile(global, "utf8")).toContain("scope: global");
    expect(existsSync(peer)).toBe(false);
    expect(existsSync(join(other, ".claude", ".semantic-memory", "skills-archive", "release-checklist", "SKILL.md"))).toBe(true);
    expect(readLedger(other).map((x) => x.action)).toEqual(["archive"]);
  });

  it("a patch lands only on the exact bytes it was drafted from; rollback restores them", async () => {
    const meta = { schema: 1 as const, scope: "project" as const, status: "active" as const, pinned: false, triggers: [], applies_to: { paths: [], commands: [] }, provenance: { sessions: ["s0"], failures: ["f0"], corrections: [] }, cites: [], supersedes: [] };
    const original = renderSkill({ name: "release-checklist", description: "Cut a release. Use when releasing.", meta, body: BODY });
    await mkdir(join(repo, ".claude", "skills", "release-checklist"), { recursive: true });
    await writeFile(dest(), original);
    const { findSkills } = await import("../../src/core/skill-schema.js");
    const patchDraft = async () => {
      const r = await materializeDraft(repo, { ...job, repo }, { kind: "patch", target: "release-checklist", name: "release-checklist", description: "Cut a release, bumping all five fields. Use when releasing.", scope: "project", body: BODY.replace("1. Run", "1. Bump the five fields.\n2. Run"), provenance: { failures: ["f1"] } } as any, findSkills(repo, { home }), undefined, env);
      return r.id!;
    };
    const id = await patchDraft();
    expect(describeDrafts(repo, env)[0].diff).toContain("+2. Run");
    await writeFile(dest(), original + "\nhand edit\n");
    expect(() => approveDraft(repo, id, { env })).toThrow(/changed since/);
    await writeFile(dest(), original);
    const e = approveDraft(repo, id, { env });
    expect(await readFile(dest(), "utf8")).toContain("Bump the five fields");
    rollback(repo, e.id);
    expect(await readFile(dest(), "utf8")).toBe(original);
    expect(readLedger(repo).map((x) => x.action)).toEqual(["patch", "rollback"]);
  });

  it("rolling back a landing removes the skill (its bytes stay in the ledger) and refuses if changed since", async () => {
    const e = approveDraft(repo, await make(), { env });
    await writeFile(dest(), "edited");
    expect(() => rollback(repo, e.id)).toThrow(/changed since/);
    const landed = readLedger(repo)[0].files[0].after!;
    await writeFile(dest(), await readFile(join(repo, ".claude", ".semantic-memory", "skill-ledger-blobs", landed)));
    rollback(repo, e.id);
    expect(existsSync(join(repo, ".claude", "skills", "release-checklist"))).toBe(false);
  });

  it("SessionStart says once how many drafts wait; not on clear/compact, not when off", async () => {
    const { main } = await import(join(ROOT, "hooks", "skill-loop.js"));
    await make();
    const out: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => (out.push(String(s)), true);
    try {
      await main({ cwd: repo, hook_event_name: "SessionStart", source: "startup" }, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "1" });
      await main({ cwd: repo, hook_event_name: "SessionStart", source: "compact" }, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "1" });
      await main({ cwd: repo, hook_event_name: "SessionStart", source: "startup" }, { ...env, SEMANTIC_MEMORY_SKILL_LOOP: "" });
    } finally {
      (process.stdout as any).write = write;
    }
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]).hookSpecificOutput.additionalContext).toContain("1 skill draft waiting");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";
import { plan, curate, curatorDue, restore, verifySkills, curatorStatePath } from "../../src/core/skill-curator.js";
import { findSkills, renderSkill, type SkillLoopMeta } from "../../src/core/skill-schema.js";
import { readLedger, rollback } from "../../src/core/skill-ledger.js";
import { evidencePath } from "../../src/core/skill-evidence.js";
import { proposeMerges, mergeCandidates } from "../../src/core/skill-merge.js";
import { listDrafts } from "../../src/core/skill-review.js";
import { approveDraft } from "../../src/core/skill-land.js";
import { fakeJevLoop } from "../jev-fake.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DAY = 86_400_000;
const BODY = (cmd = "true") => `## When to use\nx.\n\n## Steps\n1. y\n\n## Pitfalls\n- z (failure f1).\n\n## Verify\n\`${cmd}\`\n`;
const META: SkillLoopMeta = { schema: 1, scope: "project", status: "active", pinned: false, triggers: [], applies_to: { paths: [], commands: [] }, provenance: { sessions: ["s0"], failures: ["f1"], corrections: [] }, cites: [], supersedes: [] };

describe("skill-loop curator (v1.7)", () => {
  let repo: string, home: string, env: NodeJS.ProcessEnv;
  const now = Date.parse("2026-12-01T12:00:00Z");
  const put = async (name: string, over: Partial<SkillLoopMeta> = {}, opts: { learned?: boolean; mtime?: number; desc?: string; body?: string } = {}) => {
    const dir = join(repo, ".claude", "skills", name);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    await writeFile(path, opts.learned === false ? `---\nname: ${name}\ndescription: hand written\n---\nhi\n` : renderSkill({ name, description: opts.desc ?? `Do ${name}. Use when ${name} is needed.`, meta: { ...META, ...over }, body: opts.body ?? BODY() }));
    const t = new Date(opts.mtime ?? now - 60 * DAY);
    await utimes(path, t, t);
    return path;
  };
  const used = (skill: string, ago: number) => {
    const p = evidencePath(repo, "usage");
    ensureParent(p);
    appendFileSync(p, JSON.stringify({ ts: new Date(now - ago * DAY).toISOString(), session_id: "s", skill, via: "tool" }) + "\n");
  };
  const ensureParent = (p: string) => mkdirSync(join(p, ".."), { recursive: true });

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-cur-repo-"));
    home = await mkdtemp(join(tmpdir(), "sm-cur-home-"));
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
    env = { ...process.env, HOME: home, SEMANTIC_MEMORY_STATE_HOME: join(home, ".sm"), SEMANTIC_MEMORY_JEV: "" };
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("14 days unused → stale, 30 → archived; pinned, cited, young and hand-written skills are left alone", async () => {
    await put("old-one");
    used("old-one", 40);
    await put("idle-one");
    used("idle-one", 20);
    await put("fresh-one");
    used("fresh-one", 2);
    await put("pinned-one", { pinned: true });
    await put("young-never-used", {}, { mtime: now - 3 * DAY });
    await put("cited-one");
    await put("citer", {}, { body: BODY() + "\nSee /cited-one first.\n" });
    used("citer", 1);
    await put("mine", {}, { learned: false });
    const byName = Object.fromEntries(plan(repo, now, env).map((a) => [a.skill, a.action]));
    expect(byName).toEqual({ "old-one": "archive", "idle-one": "stale", "fresh-one": "keep", citer: "keep", "pinned-one": "skip", "young-never-used": "skip", "cited-one": "skip" });
    const before = await readFile(join(repo, ".claude", "skills", "mine", "SKILL.md"), "utf8");
    const r = curate(repo, { now, env });
    expect(r.ledger).toHaveLength(2);
    expect(existsSync(join(repo, ".claude", "skills", "old-one"))).toBe(false);
    expect(await readFile(join(repo, ".claude", ".semantic-memory", "skills-archive", "old-one", "SKILL.md"), "utf8")).toContain("status: archived");
    expect(findSkills(repo, { home, global: false }).map((s) => s.skill.name)).not.toContain("old-one");
    expect(await readFile(join(repo, ".claude", "skills", "idle-one", "SKILL.md"), "utf8")).toContain("status: stale");
    expect(await readFile(join(repo, ".claude", "skills", "mine", "SKILL.md"), "utf8")).toBe(before);
    expect(JSON.parse(await readFile(curatorStatePath(repo), "utf8")).last_report).toContain("archive old-one");
  });

  it("a stale skill used again goes back to active; --dry-run changes nothing", async () => {
    const p = await put("back-again", { status: "stale" });
    used("back-again", 1);
    expect(curate(repo, { now, env, dryRun: true }).actions[0].action).toBe("reactivate");
    expect(await readFile(p, "utf8")).toContain("status: stale");
    curate(repo, { now, env });
    expect(await readFile(p, "utf8")).toContain("status: active");
  });

  it("restore and rollback bring back the exact bytes", async () => {
    const p = await put("old-one");
    const original = await readFile(p, "utf8");
    used("old-one", 40);
    const [id] = curate(repo, { now, env }).ledger;
    rollback(repo, id);
    expect(await readFile(p, "utf8")).toBe(original);
    curate(repo, { now, env });
    expect(existsSync(p)).toBe(false);
    restore(repo, "old-one");
    expect(await readFile(p, "utf8")).toContain("status: active");
    expect(existsSync(join(repo, ".claude", ".semantic-memory", "skills-archive", "old-one", "SKILL.md"))).toBe(false);
    expect(readLedger(repo).map((e) => e.action)).toEqual(["archive", "rollback", "archive", "restore"]);
  });

  it("first run is deferred one interval; then due only every 7 days and when the repo is quiet", async () => {
    expect(curatorDue(repo, now)).toBe(false); // first sight
    expect(curatorDue(repo, now + 3 * DAY)).toBe(false);
    expect(curatorDue(repo, now + 8 * DAY)).toBe(true);
    used("x", 0); // activity "now" (file mtime is real time; use a far-future now to stay quiet)
    curate(repo, { now: now + 8 * DAY, env });
    expect(curatorDue(repo, now + 10 * DAY)).toBe(false);
    expect(curatorDue(repo, Date.now() + 1000)).toBe(false); // evidence written just now: not quiet
  });

  it("verify runs landed skills' Verify commands and flags failures without archiving", async () => {
    await put("passes", {}, { body: BODY("true") });
    await put("fails", {}, { body: BODY("false") });
    const r = verifySkills(repo, { env });
    expect(Object.fromEntries(r.map((x) => [x.skill, x.result]))).toEqual({ passes: "pass", fails: "fail" });
    expect(existsSync(join(repo, ".claude", "skills", "fails"))).toBe(true);
    expect(JSON.parse(await readFile(curatorStatePath(repo), "utf8")).flagged[0].name).toBe("fails");
  });

  describe("merge (opt-in)", () => {
    let jev: { dir: string; env: NodeJS.ProcessEnv };
    let tmp: string;
    beforeEach(async () => {
      jev = await fakeJevLoop();
      tmp = await mkdtemp(join(tmpdir(), "sm-cur-tmp-"));
      env = { ...env, ...jev.env, HOME: home, SEMANTIC_MEMORY_JEV: "1", SEMANTIC_MEMORY_CLAUDE_BIN: join(ROOT, "test", "bin", "claude"), SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(tmp, "slots"), FAKE_CLAUDE_RULES: join(tmp, "rules.json"), FAKE_CLAUDE_LOG: join(tmp, "log.jsonl") };
      await put("restart-vite-dev-server", {}, { desc: "Restart the vite dev server cleanly. Use when the vite dev server will not restart." });
      await put("restart-vite-server", {}, { desc: "Restart the vite server without pkill. Use when vite dev server restart fails." });
      await put("rotate-api-keys", {}, { desc: "Rotate the API keys in the vault. Use when a key leaks." });
      const merged = { drafts: [{ kind: "new", name: "restart-vite-dev-server", description: "Restart the vite dev server cleanly. Use when the vite dev server will not restart.", scope: "project", body: BODY(), provenance: {} }] };
      await writeFile(join(tmp, "rules.json"), JSON.stringify([{ match: "*", result: JSON.stringify(merged) }]));
    });
    afterEach(async () => {
      await rm(jev.dir, { recursive: true, force: true });
      await rm(tmp, { recursive: true, force: true });
    });

    it("pairs come from word overlap only", () => {
      expect(mergeCandidates(repo, env).map((c) => [c.a.skill.name, c.b.skill.name].sort().join("+"))).toEqual(["restart-vite-dev-server+restart-vite-server"]);
    });

    it("Jev no → nothing drafted; Jev yes → one merge draft that supersedes both; approving it archives the other", async () => {
      await writeFile(join(jev.dir, "mode"), "no");
      expect((await proposeMerges(repo, env)).drafted).toEqual([]);
      expect(existsSync(join(tmp, "log.jsonl"))).toBe(false); // no claude call after a Jev no
      await writeFile(join(jev.dir, "mode"), "yes");
      const m = await proposeMerges(repo, env);
      expect(m.drafted).toHaveLength(1);
      const [d] = listDrafts(repo);
      expect(d.record.kind).toBe("merge");
      expect(d.record.supersedes?.map((p) => p.split("/").at(-2)).sort()).toEqual(["restart-vite-dev-server", "restart-vite-server"]);
      approveDraft(repo, d.record.id, { env });
      expect(existsSync(join(repo, ".claude", "skills", "restart-vite-server"))).toBe(false);
      expect(existsSync(join(repo, ".claude", ".semantic-memory", "skills-archive", "restart-vite-server", "SKILL.md"))).toBe(true);
      expect(readLedger(repo).at(-1)?.action).toBe("merge");
    });

    it("the curator never merges unless asked (no consolidate config, no --merge)", async () => {
      curate(repo, { now, env });
      expect(listDrafts(repo)).toEqual([]);
    });
  });
});

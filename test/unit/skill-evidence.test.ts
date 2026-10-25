import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidence, readEvidence, detectCorrection, slashSkill, failureRecord, repoRoot, evidencePath } from "../../src/core/skill-evidence.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const j = (...p: string[]) => p.join("");
const FAKE_SECRET = j("np", "m_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");

describe("skill-loop evidence (v1.7)", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-evidence-"));
    await mkdir(join(repo, ".git"));
  });
  afterEach(async () => rm(repo, { recursive: true, force: true }));

  it("correction cues are detected; ordinary prompts are not", () => {
    for (const p of ["no, use pnpm", "No. That deletes the branch", "that's wrong, it's port 5173", "use the API instead", "don't push to main", "you forgot the lockfile", "stop", "this is not what I asked for", "please don't touch the migrations"]) {
      expect(detectCorrection(p), p).not.toBeNull();
    }
    for (const p of ["now deploy it", "I don't know why the test fails", "no rush, whenever", "nothing changed?", "Can you stop the server and restart it", "`git push --no-verify` failed", "notes on the design"]) {
      expect(detectCorrection(p), p).toBeNull();
    }
  });

  it("slash skills are recognised", () => {
    expect(slashSkill("/restart-dev-server now")).toBe("restart-dev-server");
    expect(slashSkill("use /restart")).toBeNull();
  });

  it("free text is redacted, ids are kept", async () => {
    appendEvidence(repo, "failures", failureRecord({ session_id: "3bdbcee7-0a96-4d16-b368-69a740692b7e", tool_use_id: "toolu_01T7NcCXdofyEoR7srF8xxAT", tool_name: "Bash", tool_input: { command: `npm publish --token ${FAKE_SECRET}` }, error: `401 for ${FAKE_SECRET}` }));
    const raw = await readFile(evidencePath(repo, "failures"), "utf8");
    expect(raw).not.toContain(FAKE_SECRET);
    const [r] = readEvidence(repo, "failures");
    expect(r).toMatchObject({ session_id: "3bdbcee7-0a96-4d16-b368-69a740692b7e", id: "toolu_01T7NcCXdofyEoR7srF8xxAT", tool: "Bash" });
    expect(r.ts).toMatch(/^\d{4}-/);
  });

  it("rotates at the size cap and reads both files", async () => {
    const env = { SEMANTIC_MEMORY_SKILL_LOOP_EVIDENCE_MB: "0.0001" }; // ~100 bytes
    for (let i = 0; i < 5; i++) appendEvidence(repo, "usage", { session_id: "s", skill: `k${i}`, via: "tool" }, env);
    expect(existsSync(evidencePath(repo, "usage") + ".1")).toBe(true);
    expect((await stat(evidencePath(repo, "usage"))).size).toBeLessThan(400);
    expect(readEvidence(repo, "usage").length).toBeGreaterThanOrEqual(2);
  });

  it("repoRoot walks up to the .git folder", async () => {
    await mkdir(join(repo, "apps", "web"), { recursive: true });
    expect(repoRoot(join(repo, "apps", "web"))).toBe(repo);
  });

  describe("hooks", () => {
    const hook = (file: string, input: object, env: Record<string, string>) =>
      spawnSync("node", [join(ROOT, "hooks", file)], { input: JSON.stringify({ cwd: repo, session_id: "s1", ...input }), encoding: "utf8", env: { ...process.env, SEMANTIC_MEMORY_SKILL_LOOP: "", ...env } });
    const skillUse = { hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "restart-dev-server" } };

    it("PostToolUse Skill → one usage line when on; nothing when off or inside a reviewer run", () => {
      hook("skill-loop.js", skillUse, {});
      expect(existsSync(evidencePath(repo, "usage"))).toBe(false);
      hook("skill-loop.js", skillUse, { SEMANTIC_MEMORY_SKILL_LOOP: "1", SEMANTIC_MEMORY_REVIEWER: "1" });
      expect(existsSync(evidencePath(repo, "usage"))).toBe(false);
      hook("skill-loop.js", skillUse, { SEMANTIC_MEMORY_SKILL_LOOP: "1" });
      expect(readEvidence(repo, "usage")).toEqual([expect.objectContaining({ session_id: "s1", skill: "restart-dev-server", via: "tool" })]);
    });

    it("the repo override turns it off even when the env says on", async () => {
      await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
      await writeFile(join(repo, ".claude", ".semantic-memory", "config"), "skill_loop: off\n");
      hook("skill-loop.js", skillUse, { SEMANTIC_MEMORY_SKILL_LOOP: "1" });
      expect(existsSync(evidencePath(repo, "usage"))).toBe(false);
    });

    it("the main hook records failures (without the failure hook) and corrections; off writes nothing", () => {
      const fail = { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "npm test" }, error: "Exit code 1", tool_use_id: "t1" };
      const correction = { hook_event_name: "UserPromptSubmit", prompt: "no, run it with pnpm instead" };
      hook("vault-context.js", fail, {});
      hook("vault-context.js", correction, {});
      expect(existsSync(join(repo, ".claude", ".semantic-memory"))).toBe(false);
      const out = hook("vault-context.js", fail, { SEMANTIC_MEMORY_SKILL_LOOP: "1" });
      expect(JSON.parse(out.stdout)).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUseFailure" } });
      hook("vault-context.js", correction, { SEMANTIC_MEMORY_SKILL_LOOP: "1" });
      expect(readEvidence(repo, "failures")).toEqual([expect.objectContaining({ id: "t1", command: "npm test", error: "Exit code 1" })]);
      expect(readEvidence(repo, "corrections")).toEqual([expect.objectContaining({ session_id: "s1", cue: "no" })]);
    });

    it("the off path is fast: skill-loop.js main() under 50 ms", async () => {
      const { main } = await import(join(ROOT, "hooks", "skill-loop.js"));
      await main(skillUse, { ...process.env, SEMANTIC_MEMORY_SKILL_LOOP: "" }); // warm the imports
      const t = performance.now();
      await main({ cwd: repo, ...skillUse }, { ...process.env, SEMANTIC_MEMORY_SKILL_LOOP: "" });
      expect(performance.now() - t).toBeLessThan(50);
    });
  });
});

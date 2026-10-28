import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FAKE = join(ROOT, "test", "bin", "claude");

// 1.7.1: a session started from cron (PATH=/usr/bin:/bin, no ~/.local/bin) ends → the detached worker still finds
// claude in ~/.local/bin; the session is resumed, gets a correction, ends again → one follow-up review.
describe("skill loop from a cron session (1.7.1)", () => {
  let repo: string, home: string, env: NodeJS.ProcessEnv;
  const done = () => join(home, ".semantic-memory", "review-queue", "done", "c1.json");
  const hook = (input: object) =>
    spawnSync(process.execPath, [join(ROOT, "hooks", "skill-loop.js")], { input: JSON.stringify({ cwd: repo, session_id: "c1", ...input }), encoding: "utf8", env });
  const waitFor = async (ok: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 100));
  };

  beforeAll(async () => {
    [repo, home] = await Promise.all(["sm-cron-repo-", "sm-cron-home-"].map((p) => mkdtemp(join(tmpdir(), p))));
    await mkdir(join(repo, ".git"));
    // the fake claude lives only where the real one is installed; it runs node by absolute path (cron has no node on PATH here)
    await mkdir(join(home, ".local", "bin"), { recursive: true });
    await writeFile(join(home, ".local", "bin", "claude"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    await chmod(join(home, ".local", "bin", "claude"), 0o755);
    await writeFile(join(home, "rules.json"), JSON.stringify([{ match: "*", result: JSON.stringify({ drafts: [], none_reason: "nothing reusable" }) }]));
    env = {
      HOME: home,
      PATH: "/usr/bin:/bin",
      SEMANTIC_MEMORY_STATE_HOME: join(home, ".semantic-memory"),
      SEMANTIC_MEMORY_SKILL_LOOP: "1",
      SEMANTIC_MEMORY_SKILL_LOOP_ALLOW_TMP: "1",
      SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(home, "slots"),
      FAKE_CLAUDE_RULES: join(home, "rules.json"),
    };
  });
  afterAll(async () => {
    for (const d of [repo, home]) await rm(d, { recursive: true, force: true });
  });

  it("the worker finds claude without PATH, and a resumed session is reviewed once more for its new evidence", async () => {
    const { appendEvidence } = await import("../../src/core/skill-evidence.js");
    appendEvidence(repo, "failures", { session_id: "c1", id: "f1", tool: "Bash", command: "./deploy.sh", error: "Exit code 3" });
    hook({ hook_event_name: "SessionEnd", reason: "other" });
    await waitFor(async () => existsSync(done()));
    const first = JSON.parse(await readFile(done(), "utf8"));
    expect(first.result).toMatchObject({ drafts: [], note: "nothing reusable" });
    const log = () => readFile(join(repo, ".claude", ".semantic-memory", "skill-loop.log"), "utf8");
    expect(await log()).not.toContain("ENOENT");

    hook({ hook_event_name: "SessionEnd", reason: "other" }); // resumed, nothing new: no second review
    await new Promise((r) => setTimeout(r, 300));
    expect(JSON.parse(await readFile(done(), "utf8")).finished).toBe(first.finished);

    appendEvidence(repo, "corrections", { session_id: "c1", cue: "no", excerpt: "no, run it with --dry-run first" });
    hook({ hook_event_name: "SessionEnd", reason: "prompt_input_exit" });
    await waitFor(async () => JSON.parse(await readFile(done(), "utf8")).finished !== first.finished);
    const second = JSON.parse(await readFile(done(), "utf8"));
    expect(second).toMatchObject({ since: first.finished, reason: expect.stringContaining("resumed since its review") });
    expect((await log()).match(/reviewed c1/g)).toHaveLength(2);
  });
});

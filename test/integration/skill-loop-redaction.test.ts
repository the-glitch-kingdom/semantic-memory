import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drain } from "../../src/core/skill-worker.js";
import { reviewSession, listDrafts } from "../../src/core/skill-review.js";
import { approveDraft } from "../../src/core/skill-land.js";
import { curate } from "../../src/core/skill-curator.js";

// v1.7: every new skill-loop write point (evidence logs, queue, drafts, ledger + blobs, index, curator state)
// is driven with fake secrets through the real hooks and the reviewer (fake claude); none may reach disk.
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const j = (...p: string[]) => p.join("");
const RANDOM = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FAKES = [j("gh", "p_", RANDOM), j("np", "m_", RANDOM), j("s", "k_", "live_", RANDOM), j("AK", "IA", "ABCDEFGH12345678"), j("xo", "xb-", "1234567890-", RANDOM)];

function scan(dir: string, hits: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) scan(p, hits);
    else {
      const text = readFileSync(p, "latin1");
      for (const f of FAKES) if (text.includes(f)) hits.push(`${p}: ${f.slice(0, 6)}…`);
    }
  }
  return hits;
}

describe("skill loop: no fake secret reaches disk (v1.7)", () => {
  let repo: string, state: string, tmp: string, env: NodeJS.ProcessEnv;
  beforeAll(async () => {
    [repo, state, tmp] = await Promise.all(["sm-red-repo-", "sm-red-state-", "sm-red-tmp-"].map((p) => mkdtemp(join(tmpdir(), p))));
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "scripts"));
    await writeFile(join(repo, "scripts", "deploy.sh"), "");
    env = {
      ...process.env,
      HOME: state,
      SEMANTIC_MEMORY_STATE_HOME: join(state, ".semantic-memory"),
      SEMANTIC_MEMORY_SKILL_LOOP: "1",
      SEMANTIC_MEMORY_JEV: "",
      SEMANTIC_MEMORY_CLAUDE_BIN: join(ROOT, "test", "bin", "claude"),
      SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(tmp, "slots"),
      FAKE_CLAUDE_RULES: join(tmp, "rules.json"),
    };
  });
  afterAll(async () => {
    for (const d of [repo, state, tmp]) await rm(d, { recursive: true, force: true });
  });

  it("hooks → queue → reviewer → draft → approve → curate: zero fake values anywhere", async () => {
    const hook = (file: string, input: object) =>
      spawnSync("node", [join(ROOT, "hooks", file)], { input: JSON.stringify({ cwd: repo, session_id: "s1", ...input }), encoding: "utf8", env });
    const transcript = join(tmp, "s1.jsonl");
    await writeFile(
      transcript,
      [
        { type: "user", message: { content: `deploy with ${FAKES[0]}` } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `./scripts/deploy.sh --token ${FAKES[1]}` } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: `401: bad key ${FAKES[2]}` }] } },
      ].map((l) => JSON.stringify(l)).join("\n"),
    );
    hook("vault-context.js", { hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "t1", tool_input: { command: `./scripts/deploy.sh --token ${FAKES[1]}` }, error: `401: bad key ${FAKES[2]}` });
    hook("vault-context.js", { hook_event_name: "UserPromptSubmit", prompt: `no, use the other key ${FAKES[3]} instead` });
    hook("skill-loop.js", { hook_event_name: "PostToolUse", tool_name: "Skill", tool_input: { skill: "deploy" } });
    // a live lock: SessionEnd writes the job and spawns nothing; this test drains it itself
    await mkdir(join(repo, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(join(repo, ".claude", ".semantic-memory", "skill-loop.lock"), `${process.pid}\n`);
    hook("skill-loop.js", { hook_event_name: "SessionEnd", reason: "other", transcript_path: transcript });
    await rm(join(repo, ".claude", ".semantic-memory", "skill-loop.lock"));
    // the reviewer echoes every secret back, in every field
    const body = `## When to use\nDeploy fails with 401.\n\n## Steps\n1. Run ./scripts/deploy.sh --token ${FAKES[4]}\n\n## Pitfalls\n- Wrong key ${FAKES[0]} (failure t1).\n\n## Verify\n\`true\`\n`;
    await writeFile(join(tmp, "rules.json"), JSON.stringify([{ match: "*", result: JSON.stringify({ drafts: [{ kind: "new", name: "deploy-with-token", description: `Deploy with the right token ${FAKES[1]}. Use when deploy fails with 401.`, scope: "project", triggers: [FAKES[2]], applies_to: { paths: ["scripts"], commands: [] }, provenance: { sessions: ["s1"], failures: ["t1"] }, body }] }) }]));
    const r = await drain(repo, (job) => reviewSession(job, { env }), env);
    expect(r.reviewed).toBe(1);
    const [d] = listDrafts(repo);
    expect(d).toBeDefined();
    approveDraft(repo, d.record.id, { env });
    curate(repo, { env, now: Date.now() + 40 * 86_400_000 }); // archives it: another copy, another ledger blob
    expect(scan(repo)).toEqual([]);
    expect(scan(state)).toEqual([]);
  });
});

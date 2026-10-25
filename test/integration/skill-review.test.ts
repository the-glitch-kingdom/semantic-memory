import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidence } from "../../src/core/skill-evidence.js";
import { buildBrief, reviewSession, transcriptTimeline, listDrafts, parseReviewerJson, draftsDir } from "../../src/core/skill-review.js";
import { renderSkill } from "../../src/core/skill-schema.js";
import type { ReviewJob } from "../../src/core/skill-queue.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const FAKE_CLAUDE = join(ROOT, "test", "bin", "claude");
const j = (...p: string[]) => p.join("");
const FAKE_SECRET = j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");

const BODY = "## When to use\nVite will not stop.\n\n## Steps\n1. `pgrep -f '[v]ite' | xargs kill`\n\n## Pitfalls\n- pkill -f matched its own shell (failure t1).\n\n## Verify\n```\n! pgrep -f '[v]ite'\n```\n";
const draft = (over: Record<string, unknown> = {}) => ({
  kind: "new",
  name: "stop-vite-dev-server",
  description: "Stop the Vite dev server without killing your shell. Use when pkill -f exits 144.",
  scope: "project",
  applies_to: { paths: ["scripts"], commands: ["pgrep"] },
  triggers: ["Exit code 144"],
  provenance: { sessions: ["s1"], failures: ["t1"], corrections: [] },
  cites: [],
  body: BODY,
  ...over,
});

function treeHash(dir: string, skip: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (p.startsWith(skip)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else h.update(relative(dir, p)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

describe("skill-loop reviewer (v1.7, fake claude)", () => {
  let repo: string;
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let job: ReviewJob;
  const answer = (obj: unknown) => writeFile(join(tmp, "rules.json"), JSON.stringify([{ match: "*", result: JSON.stringify(obj) }]));
  const runs = async () => (await readFile(join(tmp, "log.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "sm-review-repo-"));
    tmp = await mkdtemp(join(tmpdir(), "sm-review-tmp-"));
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "scripts"));
    await writeFile(join(repo, "scripts", "dev.sh"), "npm run dev\n");
    env = { ...process.env, SEMANTIC_MEMORY_STATE_HOME: join(tmp, "state"), SEMANTIC_MEMORY_CLAUDE_BIN: FAKE_CLAUDE, SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(tmp, "slots"), FAKE_CLAUDE_LOG: join(tmp, "log.jsonl"), FAKE_CLAUDE_RULES: join(tmp, "rules.json") };
    appendEvidence(repo, "failures", { session_id: "s1", id: "t1", tool: "Bash", command: `pkill -f vite --token ${FAKE_SECRET}`, error: "Exit code 144" });
    const transcript = join(tmp, "s1.jsonl");
    await writeFile(
      transcript,
      [
        { type: "user", message: { content: "restart the dev server" }, origin: { kind: "human" } },
        { type: "user", isMeta: true, message: { content: "meta noise" } },
        { type: "user", message: { content: "<command-name>/clear</command-name>" } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pkill -f vite" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: `Exit code 144 ${FAKE_SECRET}` }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "pgrep -f '[v]ite' | xargs kill" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "" }] } },
        "not json",
      ].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"),
    );
    job = { session_id: "s1", repo, transcript_path: transcript, reason: "1 failure(s)", ts: new Date().toISOString(), evidence: { failures: ["t1"], corrections: 0, skills_used: [], tool_calls: 0 } };
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  });

  it("reads the transcript fail-soft: prompts, calls, errors; skips meta and wrappers", () => {
    const t = transcriptTimeline(job.transcript_path);
    expect(t[0]).toBe("USER: restart the dev server");
    expect(t.join("\n")).not.toContain("meta noise");
    expect(t.join("\n")).not.toContain("/clear");
    expect(t[1]).toContain("TOOL Bash: pkill -f vite\n  → ERROR (t1): Exit code 144");
    expect(t[2]).toBe("TOOL Bash: pgrep -f '[v]ite' | xargs kill → ok");
    expect(transcriptTimeline(join(tmp, "missing.jsonl"))).toEqual([]);
  });

  it("the brief is redacted and capped", () => {
    const brief = buildBrief(job);
    expect(brief).not.toContain(FAKE_SECRET);
    expect(brief).toContain("id t1");
    appendEvidence(repo, "failures", { session_id: "s1", id: "big", tool: "Bash", command: "x", error: "y".repeat(900) });
    const big = buildBrief({ ...job, transcript_path: null }, Array.from({ length: 400 }, (_, i) => ({ path: `p${i}`, dir: `d${i}`, scope: "project" as const, learned: false, skill: { name: `skill-${i}`, description: "d".repeat(150), meta: null, rawMeta: null, body: "", sections: [], frontmatter: {} } })));
    expect(big.length).toBeLessThanOrEqual(40_100);
  });

  it("a good answer becomes one linted draft; the run is fenced; nothing outside skill-drafts/ changes", async () => {
    await answer({ drafts: [draft()] });
    const before = treeHash(repo, draftsDir(repo));
    const out = await reviewSession(job, { env });
    expect(out).toMatchObject({ drafts: [expect.stringMatching(/^stop-vite-dev-server-[0-9a-f]{8}$/)], rejected: [] });
    expect(treeHash(repo, draftsDir(repo))).toBe(before);
    const [d] = listDrafts(repo);
    expect(d.record).toMatchObject({ kind: "new", name: "stop-vite-dev-server", scope: "project", session_id: "s1" });
    const text = await readFile(join(d.dir, "SKILL.md"), "utf8");
    expect(text).toContain("status: draft");
    expect(text).toContain("generated_by: semantic-memory");
    const [run] = await runs();
    expect(run.args[run.args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(run.cwd).toBe(repo);
    expect(run.prompt).not.toContain(FAKE_SECRET);
  });

  it("drafts without evidence or failing lint are rejected with reasons", async () => {
    const quiet = { ...job, evidence: { failures: [], corrections: 0, skills_used: [], tool_calls: 30 } };
    await answer({
      drafts: [
        draft({ provenance: { sessions: ["s1"], failures: [], corrections: [] } }),
        draft({ name: "vague", description: "Helps with stuff." }),
      ],
    });
    const out = await reviewSession(quiet, { env });
    expect(out.drafts).toEqual([]);
    expect(out.rejected.map((r) => r.reason)).toEqual([expect.stringContaining("no failure or correction"), expect.stringContaining("lint: description")]);
    expect(listDrafts(repo)).toEqual([]);
  });

  it("a secret in a draft body is masked before the draft is written", async () => {
    await answer({ drafts: [draft({ body: BODY.replace("## Verify", `Token: ${FAKE_SECRET}\n\n## Verify`) })] });
    const out = await reviewSession(job, { env });
    expect(out.drafts).toHaveLength(1);
    expect(await readFile(join(listDrafts(repo)[0].dir, "SKILL.md"), "utf8")).not.toContain(FAKE_SECRET);
  });

  it("patch drafts: only for learned, unpinned skills; records the base hash", async () => {
    const put = async (name: string, raw: string) => {
      await mkdir(join(repo, ".claude", "skills", name), { recursive: true });
      await writeFile(join(repo, ".claude", "skills", name, "SKILL.md"), raw);
    };
    const meta = { schema: 1 as const, scope: "project" as const, status: "active" as const, pinned: false, triggers: [], applies_to: { paths: [], commands: [] }, provenance: { sessions: ["s0"], failures: [], corrections: [] }, cites: [], supersedes: [] };
    await put("stop-vite-dev-server", renderSkill({ name: "stop-vite-dev-server", description: "Stop Vite. Use when it will not stop.", meta, body: BODY }));
    await put("pinned-one", renderSkill({ name: "pinned-one", description: "Pinned. Use when pinned.", meta: { ...meta, pinned: true }, body: BODY }));
    await put("mine", "---\nname: mine\ndescription: the user's own\n---\nhi\n");
    await answer({ drafts: [draft({ kind: "patch", target: "stop-vite-dev-server" }), draft({ kind: "patch", target: "pinned-one", name: "pinned-one" })] });
    let out = await reviewSession({ ...job, evidence: { ...job.evidence, skills_used: ["stop-vite-dev-server"] } }, { env });
    expect(out.drafts).toHaveLength(1);
    expect(out.rejected[0].reason).toContain("pinned");
    const [d] = listDrafts(repo);
    expect(d.record).toMatchObject({ kind: "patch", target: join(repo, ".claude", "skills", "stop-vite-dev-server", "SKILL.md"), base_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    await answer({ drafts: [draft({ kind: "patch", target: "mine", name: "mine" })] });
    out = await reviewSession(job, { env });
    expect(out.rejected[0].reason).toContain("not written by the skill loop");
  });

  it("parses JSON bare or fenced; a non-JSON answer is a rejection, not a crash", async () => {
    expect(parseReviewerJson('Here:\n```json\n{"drafts": []}\n```')).toEqual({ drafts: [] });
    expect(parseReviewerJson("no")).toBeNull();
    await writeFile(join(tmp, "rules.json"), JSON.stringify([{ match: "*", result: "I could not decide." }]));
    expect((await reviewSession(job, { env })).rejected[0].reason).toContain("not JSON");
  });
});

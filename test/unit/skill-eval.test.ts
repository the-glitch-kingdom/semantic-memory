import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, chmod } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSkill, parseSkill, type SkillLoopMeta } from "../../src/core/skill-schema.js";
import { buildEvalSet, splitOf, type EvalPrompt } from "../../src/core/skill-eval/sets.js";
import { runTrigger, makeScratch } from "../../src/core/skill-eval/trigger.js";
import { runTaskEval, parseVerify } from "../../src/core/skill-eval/task.js";
import { tuneDescription } from "../../src/core/skill-eval/tune.js";
import { parseEvals, renderEvals } from "../../src/core/skill-eval/evals-json.js";
import { gateSkill, GATE_MIN_POSITIVE_RATE, GATE_MAX_FALSE_TRIGGER_RATE } from "../../src/core/skill-gate.js";
import { fakeJevLoop } from "../jev-fake.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ROOT_TEST = join(ROOT, "test");
const FAKE_CLAUDE = join(ROOT_TEST, "bin", "claude");

const meta = (sessions: string[], commands: string[] = []): SkillLoopMeta => ({
  schema: 1,
  scope: "project",
  status: "draft",
  pinned: false,
  triggers: ["EADDRINUSE"],
  applies_to: { paths: [], commands },
  provenance: { sessions, failures: [], corrections: [] },
  cites: [],
  supersedes: [],
});
const BODY = (verify: string) => `## When to use\nPort in use.\n\n## Steps\n1. Kill it.\n\n## Pitfalls\nNone.\n\n## Verify\n${verify}\n`;
const skillRaw = (verify = "`true`", description = "Use when the dev server fails with EADDRINUSE", commands: string[] = []) =>
  renderSkill({ name: "restart-dev-server", description, meta: meta(["s1"], commands), body: BODY(verify) });

/** hash of every file in a tree, .git excluded */
function treeHash(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      if (e === ".git") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(relative(dir, p)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

describe("skill evals (fake claude, fake Jev)", () => {
  let dir: string;
  let repo: string;
  let env: NodeJS.ProcessEnv;
  const rules = (r: unknown[]) => writeFile(join(dir, "rules.json"), JSON.stringify(r));
  const log = async () => (await readFile(join(dir, "log.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const P = (text: string, should_trigger = true, split: EvalPrompt["split"] = "train"): EvalPrompt => ({ text, should_trigger, split });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sm-skill-eval-test-"));
    repo = join(dir, "repo");
    await mkdir(join(repo, ".claude", "skills", "other-skill"), { recursive: true });
    await writeFile(join(repo, ".claude", "skills", "other-skill", "SKILL.md"), "---\nname: other-skill\ndescription: something else\n---\nbody\n");
    await writeFile(join(repo, "README.md"), "hello\n");
    const git = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    env = {
      ...process.env,
      SEMANTIC_MEMORY_CLAUDE_BIN: FAKE_CLAUDE,
      SEMANTIC_MEMORY_CLAUDE_SLOTS_DIR: join(dir, "slots"),
      SEMANTIC_MEMORY_SKILL_EVAL_CACHE: join(dir, "cache.jsonl"),
      FAKE_CLAUDE_LOG: join(dir, "log.jsonl"),
      FAKE_CLAUDE_RULES: join(dir, "rules.json"),
    };
    delete env.SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY;
    delete env.SEMANTIC_MEMORY_JEV;
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  describe("eval sets", () => {
    const skill = parseSkill(skillRaw());
    const cands = [
      { session: "s1", text: "the dev server fails with EADDRINUSE again" },
      { session: "s2", text: "why does my dev server hang on start" },
      { session: "s3", text: "write a haiku about autumn" },
    ];

    it("positives come from provenance sessions, near-misses from other sessions sharing terms", () => {
      const set = buildEvalSet(skill, cands);
      expect(set.filter((p) => p.should_trigger).map((p) => p.text)).toEqual([cands[0].text]);
      expect(set.filter((p) => !p.should_trigger).map((p) => p.text)).toEqual([cands[1].text]);
    });

    it("the train / held-out split is deterministic and about 60/40", () => {
      expect(buildEvalSet(skill, cands)).toEqual(buildEvalSet(skill, [...cands].reverse()).sort((a, b) => Number(b.should_trigger) - Number(a.should_trigger)));
      const n = 400;
      const train = Array.from({ length: n }, (_, i) => splitOf(`prompt number ${i}`)).filter((s) => s === "train").length;
      expect(train / n).toBeGreaterThan(0.5);
      expect(train / n).toBeLessThan(0.7);
      expect(splitOf("x")).toBe(splitOf("x"));
    });
  });

  describe("trigger", () => {
    it("detects called / not called / another skill called", async () => {
      await rules([
        { match: "alpha", skill: "restart-dev-server" },
        { match: "beta", result: "no skill" },
        { match: "gamma", skill: "other-skill" },
      ]);
      const before = treeHash(repo);
      const r = await runTrigger([P("alpha"), P("beta"), P("gamma", false)], { repoRoot: repo, skillRaw: skillRaw(), env });
      const by = Object.fromEntries(r.results.map((x) => [x.text, x.triggered]));
      expect(by).toEqual({ alpha: true, beta: false, gamma: false });
      expect(r.train).toMatchObject({ positiveRate: 0.5, falseTriggerRate: 0, n: 3 });
      expect(treeHash(repo)).toBe(before);
      // ran in a scratch dir outside the repo, with the skill under test and the repo's other skills, then cleaned up
      const cwd = (await log())[0].cwd;
      expect(cwd.startsWith(repo)).toBe(false);
      expect(existsSync(cwd)).toBe(false);
    });

    it("the scratch holds the skill under test and copies of the other skills", async () => {
      const s = makeScratch(repo, "restart-dev-server", skillRaw());
      expect((await readdir(join(s, ".claude", "skills"))).sort()).toEqual(["other-skill", "restart-dev-server"]);
      await rm(s, { recursive: true });
    });

    it("stops after two runs that agree; a third breaks a tie", async () => {
      await rules([
        { match: "steady", skill: "restart-dev-server" },
        { match: "flaky", cycle: ["restart-dev-server", null, "restart-dev-server"] },
      ]);
      const r = await runTrigger([P("steady"), P("flaky")], { repoRoot: repo, skillRaw: skillRaw(), env });
      const runs = Object.fromEntries(r.results.map((x) => [x.text, x.runs]));
      expect(runs).toEqual({ steady: 2, flaky: 3 });
      expect(r.results.find((x) => x.text === "flaky")).toMatchObject({ triggers: 2, triggered: true });
      expect(await log()).toHaveLength(5);
    });

    it("an unchanged skill is a cache hit (zero runs); an edited one runs again", async () => {
      await rules([{ match: "*", skill: "restart-dev-server" }]);
      const a = await runTrigger([P("alpha")], { repoRoot: repo, skillRaw: skillRaw(), env });
      expect(a.runs).toBe(2);
      const b = await runTrigger([P("alpha")], { repoRoot: repo, skillRaw: skillRaw(), env });
      expect(b.runs).toBe(0);
      expect(b.results[0]).toMatchObject({ cached: true, triggered: true, runs: 2 });
      expect(await log()).toHaveLength(2);
      const c = await runTrigger([P("alpha")], { repoRoot: repo, skillRaw: skillRaw("`true`", "a different description"), env });
      expect(c.runs).toBe(2);
    });

    it("failed runs are not votes and are not cached", async () => {
      await writeFile(join(dir, "bad-claude"), "#!/bin/sh\necho nope\n");
      await chmod(join(dir, "bad-claude"), 0o755);
      const r = await runTrigger([P("alpha")], { repoRoot: repo, skillRaw: skillRaw(), env: { ...env, SEMANTIC_MEMORY_CLAUDE_BIN: join(dir, "bad-claude") } });
      expect(r.results[0]).toMatchObject({ runs: 0, triggered: false, error: expect.stringContaining("no result") });
      expect(existsSync(join(dir, "cache.jsonl"))).toBe(false);
    });
  });

  describe("task", () => {
    const task = (verify: string, e = env, commands: string[] = []) =>
      runTaskEval({ repoRoot: repo, skillRaw: skillRaw(verify, undefined, commands), prompt: "do the task", env: e });

    it("a command Verify runs only in the scratch copy; the working tree is untouched", async () => {
      await rules([{ match: "do the task", result: "done" }]);
      const before = treeHash(repo);
      const r = await task("```bash\ntouch verified.marker && test -f README.md\n```", env, ["npm test", "git status"]);
      expect(r.with).toMatchObject({ passed: true });
      expect(r.without).toMatchObject({ passed: true });
      expect(treeHash(repo)).toBe(before);
      expect(existsSync(join(repo, "verified.marker"))).toBe(false);
      // scratch worktrees are gone, from disk and from git
      expect(execFileSync("git", ["-C", repo, "worktree", "list"]).toString().trim().split("\n")).toHaveLength(1);
      const runs = await log();
      expect(runs).toHaveLength(2);
      const a: string[] = runs[0].args;
      expect(a[a.indexOf("--tools") + 1]).toBe("Read,Grep,Glob,Edit,Write,Bash");
      expect(a[a.indexOf("--allowedTools") + 1]).toBe("Edit,Write,Bash(npm test:*),Bash(git status:*)");
      expect(runs.every((x) => !x.cwd.startsWith(repo))).toBe(true);
    });

    it("the with-skill arm has the skill, the baseline does not; a verify that depends on it tells them apart", async () => {
      await rules([{ match: "do the task", result: "done" }]);
      const r = await task("`test -f .claude/skills/restart-dev-server/SKILL.md`");
      expect(r.with.passed).toBe(true);
      expect(r.without.passed).toBe(false);
    });

    it("a failing command Verify fails the arm", async () => {
      await rules([{ match: "do the task", result: "done" }]);
      expect((await task("`false`")).with).toMatchObject({ passed: false, evidence: expect.stringContaining("failed") });
    });

    it("parses command, inline command and prose Verify sections", () => {
      expect(parseVerify(parseSkill(skillRaw("```sh\nnpm test\n```")).body)).toEqual({ kind: "command", command: "npm test" });
      expect(parseVerify(parseSkill(skillRaw("- `curl -f localhost:3000` returns 200")).body)).toEqual({ kind: "command", command: "curl -f localhost:3000" });
      expect(parseVerify(parseSkill(skillRaw("The server answers on port 3000.")).body)).toEqual({ kind: "prose", text: "The server answers on port 3000." });
    });

    it("a prose Verify is graded by Jev at 0.95 in jev mode (yes passes, no fails)", async () => {
      const jev = await fakeJevLoop();
      await rules([{ match: "do the task", result: "the server is up" }]);
      const jenv = { ...env, ...jev.env, SEMANTIC_MEMORY_JEV: "1" };
      await writeFile(join(jev.dir, "mode"), "yes");
      expect((await task("The server answers on port 3000.", jenv)).with).toMatchObject({ passed: true, evidence: "jev p=0.97" });
      await writeFile(join(jev.dir, "mode"), "no");
      expect((await task("The server answers on port 3000.", jenv)).with.passed).toBe(false);
      const calls = readFileSync(join(jev.dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(calls[0]).toMatchObject({ caller: "semantic-memory-skill-loop", state: "the server is up" });
      expect(calls[0].items[0][1]).toBe("Does this outcome satisfy: The server answers on port 3000.?");
      // no grader claude run was needed: only the two task runs per task call
      expect((await log()).every((x) => x.prompt.startsWith("do the task"))).toBe(true);
      await rm(jev.dir, { recursive: true, force: true });
    });

    it("with jev mode off, the grader prompt grades it through claude", async () => {
      await rules([
        { match: "You are a grader", result: 'Sure: {"passed": true, "evidence": "port answered"}' },
        { match: "do the task", result: "the server is up" },
      ]);
      expect((await task("The server answers on port 3000.")).with).toMatchObject({ passed: true, evidence: "port answered" });
      await rules([
        { match: "You are a grader", result: "no idea" },
        { match: "do the task", result: "x" },
      ]);
      expect((await task("The server answers on port 3000.")).with.passed).toBe(false);
      const g = (await log()).find((x) => x.prompt.includes("You are a grader"));
      expect(g.args[g.args.indexOf("--tools") + 1]).toBe("");
    });
  });

  describe("tune", () => {
    it("proposes the best description by held-out score and never writes the skill file", async () => {
      // a fake claude that triggers only when the installed description says "restart"
      const bin = join(dir, "tune-claude");
      await writeFile(
        bin,
        `#!/usr/bin/env node
const fs = require("node:fs");
const prompt = fs.readFileSync(0, "utf8");
if (prompt.includes("optimizing a skill description")) {
  process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "<new_description>Use to restart the dev server</new_description>", num_turns: 1 }) + "\\n");
} else {
  const md = fs.readFileSync(".claude/skills/restart-dev-server/SKILL.md", "utf8");
  const ev = [];
  if (md.includes("Use to restart") && prompt.includes("positive")) ev.push({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "restart-dev-server" } }] } });
  ev.push({ type: "result", subtype: "success", is_error: false, result: "ok", num_turns: 1 });
  process.stdout.write(ev.map((e) => JSON.stringify(e)).join("\\n") + "\\n");
}
`,
      );
      await chmod(bin, 0o755);
      const raw = skillRaw();
      const prompts: EvalPrompt[] = [
        P("positive one", true, "train"),
        P("positive two", true, "train"),
        P("positive held", true, "heldout"),
        P("near miss", false, "heldout"),
      ];
      const skillPath = join(repo, ".claude", "skills", "restart-dev-server", "SKILL.md");
      await mkdir(join(repo, ".claude", "skills", "restart-dev-server"), { recursive: true });
      await writeFile(skillPath, raw);
      const r = await tuneDescription({ repoRoot: repo, skillRaw: raw, prompts, env: { ...env, SEMANTIC_MEMORY_CLAUDE_BIN: bin }, maxIterations: 3 });
      expect(r.original).toMatchObject({ train: 0.0, heldout: 0.5 });
      expect(r.best).toMatchObject({ description: "Use to restart the dev server", train: 1, heldout: 1 });
      expect(r.improved).toBe(true);
      expect(r.candidates).toHaveLength(2); // the same proposal twice is not scored twice
      expect(await readFile(skillPath, "utf8")).toBe(raw);
    });
  });

  describe("gate", () => {
    const good = { positiveRate: 0.75, falseTriggerRate: 0.1, taskWith: 1, taskWithout: 0 };

    it("adopts a new skill that clears every check", () => {
      expect(gateSkill(good)).toMatchObject({ verdict: "adopt" });
    });

    it("keeps a draft that misses a check, with the reason", () => {
      expect(gateSkill({ ...good, positiveRate: 0.4 })).toMatchObject({ verdict: "keep-draft", reasons: [expect.stringContaining("positive trigger rate")] });
      expect(gateSkill({ ...good, falseTriggerRate: 0.5 }).verdict).toBe("keep-draft");
      expect(gateSkill({ ...good, positiveRate: 0.5, falseTriggerRate: 0.5 }).reasons.join()).toContain("does not beat");
      expect(gateSkill({ ...good, taskWith: 1, taskWithout: 1 }).reasons.join()).toContain("does not beat");
      expect(gateSkill({ ...good, taskWith: null }).reasons.join()).toContain("not measured");
      // the thresholds themselves are inclusive
      expect(gateSkill({ ...good, positiveRate: GATE_MIN_POSITIVE_RATE, falseTriggerRate: GATE_MAX_FALSE_TRIGGER_RATE - 0.1 }).verdict).toBe("adopt");
      expect(gateSkill({ ...good, falseTriggerRate: GATE_MAX_FALSE_TRIGGER_RATE }).verdict).toBe("adopt");
    });

    it("adopts a patch that drops nothing, rejects one that regresses any score", () => {
      expect(gateSkill(good, good).verdict).toBe("adopt");
      expect(gateSkill({ ...good, positiveRate: 0.9 }, good).verdict).toBe("adopt");
      for (const worse of [{ positiveRate: 0.5 }, { falseTriggerRate: 0.2 }, { taskWith: 0.5 }]) {
        const r = gateSkill({ ...good, ...worse }, good);
        expect(r.verdict).toBe("reject");
        expect(r.reasons[0]).toContain("regresses");
      }
      expect(gateSkill({ ...good, taskWith: null }, good).verdict).toBe("keep-draft");
    });
  });

  describe("evals.json interop", () => {
    const sample = {
      skill_name: "restart-dev-server",
      evals: [
        { id: 1, prompt: "The dev server says EADDRINUSE", expected_output: "The old process is killed and the server starts", files: ["evals/files/log.txt"], expectations: ["The output includes a kill command", "The skill was used"] },
        { id: 2, prompt: "Port 3000 is taken", expected_output: "Server on another port", expectations: [] },
      ],
    };

    it("round-trips exactly", () => {
      const text = renderEvals(sample);
      expect(parseEvals(text)).toEqual(sample);
      expect(renderEvals(parseEvals(text))).toBe(text);
      expect(text).toBe(JSON.stringify(sample, null, 2) + "\n");
    });

    it("rejects a malformed file", () => {
      expect(() => parseEvals("{}")).toThrow(/skill_name/);
      expect(() => parseEvals(JSON.stringify({ skill_name: "x", evals: [{ id: 1, prompt: "p" }] }))).toThrow(/bad eval/);
      expect(() => parseEvals(JSON.stringify({ skill_name: "x", evals: [sample.evals[0], sample.evals[0]] }))).toThrow(/duplicate/);
    });
  });

  describe("licensing", () => {
    it("every prompt file carries the Apache header and is listed in THIRD_PARTY_NOTICES.md", async () => {
      const pdir = join(ROOT, "src/core/skill-eval/prompts");
      const files = (await readdir(pdir)).filter((f) => f.endsWith(".ts"));
      expect(files.length).toBeGreaterThan(0);
      const notices = await readFile(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
      for (const f of files) {
        const src = await readFile(join(pdir, f), "utf8");
        expect(src.startsWith("/**\n * Adapted from Anthropic's skill-creator (https://github.com/anthropics/claude-plugins-official, Apache License 2.0); modified for semantic-memory.")).toBe(true);
        expect(notices).toContain(`src/core/skill-eval/prompts/${f}`);
      }
      expect(await readFile(join(ROOT, "LICENSES/Apache-2.0.txt"), "utf8")).toContain("Apache License");
      const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
      expect(pkg.files).toEqual(expect.arrayContaining(["THIRD_PARTY_NOTICES.md", "LICENSES"]));
    });
  });

  describe("concurrency", () => {
    const maxOverlap = (runs: { t0: number; t1: number }[]) => Math.max(...runs.map((r) => runs.filter((o) => o.t0 < r.t1 && r.t0 < o.t1).length));
    const twelve = Array.from({ length: 12 }, (_, i) => P(`queued prompt ${i}`));

    it("12 queued eval runs never exceed 5 live claude processes", async () => {
      await rules([{ match: "*", sleepMs: 200, skill: "restart-dev-server" }]);
      await runTrigger(twelve, { repoRoot: repo, skillRaw: skillRaw(), env });
      const runs = await log();
      expect(runs).toHaveLength(24);
      expect(maxOverlap(runs)).toBeLessThanOrEqual(5);
      expect(maxOverlap(runs)).toBeGreaterThan(1);
    }, 30_000);

    it("SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY=2 → never more than 2", async () => {
      await rules([{ match: "*", sleepMs: 120, skill: "restart-dev-server" }]);
      await runTrigger(twelve.slice(0, 6), { repoRoot: repo, skillRaw: skillRaw(), env: { ...env, SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY: "2" } });
      expect(maxOverlap(await log())).toBeLessThanOrEqual(2);
    }, 30_000);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { askJev } from "../../src/core/jev.js";
import { FAKE_ROUTER } from "../jev-fake.js";

// v1.7: the jev bridge. CI has no jev-loop, so the first block uses a fake router module; the second runs
// the real router (copied, so its ledger and cache land in a temp dir) with urlopen faked, when present.

const j = (...p: string[]) => p.join("");
const FAKE_SECRET = j("gh", "p_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8");


describe("jev bridge (fake router)", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const calls = async () => (await readFile(join(dir, "calls.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sm-jev-fake-"));
    await writeFile(join(dir, "router.py"), FAKE_ROUTER);
    await mkdir(join(dir, "logs"));
    env = { PATH: process.env.PATH, HOME: dir, JEV_LOOP_DIR: dir, TYPESAFE_API_KEY: "fake" };
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it("returns a probability per key and the tokens, under the caller's name", async () => {
    const a = await askJev(
      { cwd: "/tmp/x", caller: "semantic-memory-judge", state: "s", questions: [{ key: "a", instructions: "yes?" }, { key: "b", instructions: "no?" }] },
      { env },
    );
    expect(a).toEqual({ scores: { a: 0.97, b: 0.02 }, tokens: 42 });
    expect((await calls()).at(-1).caller).toBe("semantic-memory-judge");
  });

  it("refuses an excluded cwd and sends nothing", async () => {
    const before = (await calls()).length;
    const a = await askJev({ cwd: "/home/u/workspace/kentro/app", caller: "semantic-memory-judge", state: "s", questions: [{ key: "a", instructions: "yes" }] }, { env });
    expect(a.scores).toEqual({});
    expect(a.error).toContain("excluded");
    expect((await calls()).length).toBe(before);
  });

  it("a router error is an empty answer with the reason, never a crash", async () => {
    await writeFile(join(dir, "mode"), "raise");
    const a = await askJev({ cwd: "/tmp", caller: "semantic-memory-skill-loop", state: "s", questions: [{ key: "a", instructions: "yes" }] }, { env });
    await rm(join(dir, "mode"));
    expect(a.scores).toEqual({});
    expect(a.error).toContain("503");
  });

  it("times out within the budget and answers nothing", async () => {
    await writeFile(join(dir, "mode"), "sleep");
    const t = Date.now();
    const a = await askJev({ cwd: "/tmp", caller: "semantic-memory-hook", state: "s", questions: [{ key: "a", instructions: "yes" }] }, { env, timeoutMs: 1000 });
    await rm(join(dir, "mode"));
    expect(Date.now() - t).toBeLessThan(1500);
    expect(a).toMatchObject({ scores: {}, error: expect.stringContaining("timed out") });
    expect((await calls()).at(-1).timeout).toBeLessThan(1); // the live call's HTTP timeout fits the hook budget
  });

  it("rejects unknown callers and bad input", async () => {
    expect((await askJev({ cwd: "/tmp", caller: "nope" as any, state: "s", questions: [{ key: "a", instructions: "q" }] }, { env })).error).toContain("unknown caller");
    expect((await askJev({ cwd: "/tmp", caller: "semantic-memory-judge", state: "", questions: [] }, { env })).error).toContain("required");
  });

  it("no jev-loop or no key → reason, nothing sent", async () => {
    expect((await askJev({ cwd: "/tmp", caller: "semantic-memory-judge", state: "s", questions: [{ key: "a", instructions: "q" }] }, { env: { ...env, JEV_LOOP_DIR: join(dir, "none") } })).error).toContain("not found");
    const noKey = { ...env, TYPESAFE_API_KEY: "", SEMANTIC_MEMORY_CLAUDE_SETTINGS: join(dir, "none.json") };
    expect((await askJev({ cwd: "/tmp", caller: "semantic-memory-judge", state: "s", questions: [{ key: "a", instructions: "q" }] }, { env: noKey })).error).toContain("TYPESAFE_API_KEY");
  });

  it("the live caller stops at its daily ceiling", async () => {
    const day = new Date();
    const local = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    await writeFile(join(dir, "logs", "jev-usage-test.jsonl"), JSON.stringify({ time: `${local}T01:00:00`, caller: "semantic-memory-hook", input_tokens: 600, output_tokens: 0 }) + "\n");
    const before = (await calls()).length;
    const a = await askJev({ cwd: "/tmp", caller: "semantic-memory-hook", state: "s", questions: [{ key: "a", instructions: "yes" }] }, { env: { ...env, SEMANTIC_MEMORY_JEV_DAILY_TOKENS: "500" } });
    expect(a).toMatchObject({ scores: {}, ceiling: true });
    expect((await calls()).length).toBe(before);
    // batch callers are capped by jev-loop, not by this ceiling
    const b = await askJev({ cwd: "/tmp", caller: "semantic-memory-judge", state: "s", questions: [{ key: "a", instructions: "yes" }] }, { env: { ...env, SEMANTIC_MEMORY_JEV_DAILY_TOKENS: "500" } });
    expect(b.scores.a).toBe(0.97);
    await rm(join(dir, "logs", "jev-usage-test.jsonl"));
  });
});

const REAL = join(homedir(), ".claude", "jev-loop");
const haveReal = existsSync(join(REAL, "router.py")) && existsSync(join(REAL, "redact.py"));

describe.skipIf(!haveReal)("jev bridge (real router, fake network)", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sm-jev-real-"));
    for (const f of ["router.py", "redact.py", "config.toml"]) await copyFile(join(REAL, f), join(dir, f));
    await mkdir(join(dir, "site"));
    // sitecustomize runs before the bridge: replace urlopen, record every request body
    await writeFile(
      join(dir, "site", "sitecustomize.py"),
      `import json, os, urllib.request
class _Fake:
    def __init__(self, request, timeout=None):
        body = json.loads(request.data)
        open(os.environ["FAKE_JEV_BODIES"], "a").write(json.dumps(body) + "\\n")
        self.body = {"answers": {k: {"type": "noul", "noul": 0.96} for k in body["questions"]}, "usage": {"input_tokens": 7, "output_tokens": 0}}
    def read(self):
        return json.dumps(self.body).encode()
urllib.request.urlopen = _Fake
`,
    );
    env = { PATH: process.env.PATH, HOME: dir, JEV_LOOP_DIR: dir, TYPESAFE_API_KEY: "fake", PYTHONPATH: join(dir, "site"), FAKE_JEV_BODIES: join(dir, "bodies.jsonl") };
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it("redacts the state and questions before sending, and ledgers the caller", async () => {
    const a = await askJev(
      { cwd: "/tmp", caller: "semantic-memory-judge", state: `git push failed with token ${FAKE_SECRET}`, questions: [{ key: "q", instructions: `does ${FAKE_SECRET} matter?` }] },
      { env },
    );
    expect(a.scores.q).toBe(0.96);
    const sent = await readFile(join(dir, "bodies.jsonl"), "utf8");
    expect(sent).not.toContain(FAKE_SECRET);
    const ledger = await readFile(join(dir, "logs", (await import("node:fs")).readdirSync(join(dir, "logs")).find((f) => f.startsWith("jev-usage-"))!), "utf8");
    expect(ledger).toContain('"caller": "semantic-memory-judge"');
  });

  it("refuses the excluded path from the real config", async () => {
    // HOME is the temp dir here, so the config's ~/workspace/kentro expands under it
    const before = (await readFile(join(dir, "bodies.jsonl"), "utf8")).length;
    const a = await askJev({ cwd: join(dir, "workspace", "kentro", "app"), caller: "semantic-memory-hook", state: "s", questions: [{ key: "q", instructions: "x" }] }, { env });
    expect(a.error).toContain("excluded");
    expect((await readFile(join(dir, "bodies.jsonl"), "utf8")).length).toBe(before);
  });
});

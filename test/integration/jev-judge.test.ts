import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { rm, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeJevLoop } from "../jev-fake.js";
import { jevVerdict } from "../../src/core/jev.js";

// v1.7: scripts/eval-failures/judge-jev.mjs on both batch formats, against the fake router.
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const JUDGE = join(ROOT, "scripts", "eval-failures", "judge-jev.mjs");

describe("Jev judge", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const run = (...files: string[]) => spawnSync("node", [JUDGE, ...files], { encoding: "utf8", env, timeout: 60_000 });
  const lines = async (p: string) => (await readFile(p, "utf8")).trim().split("\n").map((l) => JSON.parse(l));

  beforeAll(async () => {
    ({ dir, env } = await fakeJevLoop());
    // set A: one failure, candidates; set B: one row per pair
    await writeFile(join(dir, "a.json"), JSON.stringify([
      { failure: "f1", repo: "grp/app", command: "pkill -f vite", error: "Exit code 144", candidates: [
        { fact: "facts/pkill.md", title: "pkill yes", claim: "kills the shell" },
        { fact: "facts/other.md", title: "unrelated", claim: "no" },
        { fact: "facts/maybe.md", title: "maybe", claim: "?" },
      ] },
    ]));
    await writeFile(join(dir, "b.json"), JSON.stringify([
      { case: "f2", path: "guides/x.md", command: "git push", error: "rejected", doc_title: "yes push", doc_excerpt: "force" },
      { case: "f2", path: "guides/y.md", command: "git push", error: "rejected", doc_title: "nope", doc_excerpt: "" },
    ]));
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it("cut-offs: yes at >= 0.95, no at <= 0.05, unsure between", () => {
    expect([jevVerdict(0.95), jevVerdict(0.05), jevVerdict(0.5), jevVerdict(undefined)]).toEqual([true, false, null, null]);
  });

  it("writes one line per pair for both formats, one call per failure", async () => {
    const r = run(join(dir, "a.json"), join(dir, "b.json"));
    expect(r.status, r.stderr).toBe(0);
    expect(await lines(join(dir, "a.jev.out.jsonl"))).toEqual([
      { case: "f1", path: "facts/pkill.md", p: 0.97, relevant: true },
      { case: "f1", path: "facts/other.md", p: 0.02, relevant: false },
      { case: "f1", path: "facts/maybe.md", p: 0.5, relevant: null },
    ]);
    expect((await lines(join(dir, "b.jev.out.jsonl"))).map((l) => l.relevant)).toEqual([true, false]);
    const calls = await lines(join(dir, "calls.jsonl"));
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.caller === "semantic-memory-judge")).toBe(true);
    expect(calls[0].state).toContain("Command: pkill -f vite");
    expect(r.stdout).toContain("judged 5 pairs: 2 yes, 2 no, 1 unsure");
  });

  it("resumes: pairs already judged are not asked again", async () => {
    const r = run(join(dir, "a.json"));
    expect(r.stdout).toContain("0 failures to judge");
    expect((await lines(join(dir, "calls.jsonl"))).length).toBe(2);
  });

  it("stops cleanly on --max-tokens and on the jev-loop budget", async () => {
    await rm(join(dir, "b.jev.out.jsonl"));
    await writeFile(join(dir, "b2.json"), JSON.stringify([
      { case: "g1", path: "a.md", command: "x", error: "e", doc_title: "yes", doc_excerpt: "" },
      { case: "g2", path: "b.md", command: "y", error: "e", doc_title: "yes", doc_excerpt: "" },
    ]));
    const r = spawnSync("node", [JUDGE, "--max-tokens", "1", "--concurrency", "1", join(dir, "b2.json")], { encoding: "utf8", env });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("stopped: --max-tokens 1 reached");
    expect((await lines(join(dir, "b2.jev.out.jsonl"))).length).toBe(1);

    await writeFile(join(dir, "mode"), "budget");
    const b = run(join(dir, "b.json"));
    await rm(join(dir, "mode"));
    expect(b.status).toBe(0);
    expect(b.stdout).toContain("stopped: RuntimeError: jev budget reached");
  });
});

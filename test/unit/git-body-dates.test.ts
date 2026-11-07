import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitBodyDates, gitCommitDates } from "../../src/core/git-dates.js";

const DAY = 86_400_000;
let dir: string;
const commit = (files: Record<string, string>, daysAgo: number) => {
  const date = new Date(Date.now() - daysAgo * DAY).toISOString();
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "c"]);
};
const days = (ms: number) => Math.round((Date.now() - ms) / DAY);

describe("gitBodyDates", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "gitbody-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.invalid"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    commit({ "a.md": "---\ntitle: A\n---\nbody one\n", "b.md": "---\ntitle: B\n---\nbody b\n", "c.md": "plain\n" }, 400);
    commit({ "a.md": "---\ntitle: A\nowner: ops\n---\nbody one\n" }, 200); // frontmatter only
    commit({ "b.md": "---\ntitle: B\n---\nbody b edited\n" }, 100); // body edit
    commit({ "a.md": "---\ntitle: A\nowner: me\n---\nbody one\n", "b.md": "---\ntitle: B2\n---\nbody b edited\n" }, 0); // bulk frontmatter touch
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("skips frontmatter-only commits, counts body edits and the first commit", async () => {
    const dates = await gitBodyDates(dir, await gitCommitDates(dir), ["a.md", "b.md", "c.md"]);
    expect(days(dates.get("a.md")!)).toBe(400);
    expect(days(dates.get("b.md")!)).toBe(100);
    expect(days(dates.get("c.md")!)).toBe(400);
  });

  it("ignores paths with no history", async () => {
    const dates = await gitBodyDates(dir, await gitCommitDates(dir), ["missing.md"]);
    expect(dates.size).toBe(0);
  });

  it("a body restored after a delete is a new body", async () => {
    commit({ "d.md": "x\n" }, 50);
    execFileSync("git", ["rm", "-q", "d.md"], { cwd: dir });
    commit({}, 40);
    commit({ "d.md": "x\n" }, 10);
    const dates = await gitBodyDates(dir, await gitCommitDates(dir), ["d.md"]);
    expect(days(dates.get("d.md")!)).toBe(10);
  });
});

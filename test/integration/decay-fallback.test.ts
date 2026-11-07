import { describe, it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext, type ServerContext } from "../../src/mcp/context.js";
import { openSearch } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

// decay.missing_last_verified (#49): the `git` fallback dates a note by its last commit with ONE `git log` per build or reconcile.

const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf-8" }).trim();
const DAY = 86_400_000;
const body = (t: string) => `# ${t}\n\nNotes about ${t}.\n`;
const dirs: string[] = [];
const origPath = process.env.PATH;

/** Put a `git` on PATH that logs its arguments, so the test can count how often the server runs git. */
function gitSpy(): () => string[][] {
  const bin = mkdtempSync(join(tmpdir(), "gitspy-"));
  dirs.push(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$@" >> "${bin}/calls"\nexec ${REAL_GIT} "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  writeFileSync(join(bin, "calls"), "");
  process.env.PATH = `${bin}:${origPath}`;
  return () => readFileSync(join(bin, "calls"), "utf-8").split("\n").filter(Boolean).map((l) => l.split(" "));
}

function vault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "decayfb-"));
  dirs.push(dir);
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return dir;
}

function commit(dir: string, daysAgo: number, ...files: string[]) {
  const when = new Date(Date.now() - daysAgo * DAY).toISOString();
  const env = { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (...a: string[]) => execFileSync(REAL_GIT, ["-C", dir, ...a], { env, stdio: "pipe" });
  try { git("rev-parse", "--git-dir"); } catch { git("init", "-q"); git("config", "user.email", "t@example.invalid"); git("config", "user.name", "t"); }
  git("add", "--", ...files);
  git("commit", "-q", "-m", "docs");
}

const open_: ServerContext[] = [];
async function open(dir: string): Promise<ServerContext> {
  const ctx = await buildContext(dir, { reconcileThrottleMs: 0 });
  open_.push(ctx);
  await ctx.fullIndex();
  return ctx;
}
const decay = (ctx: ServerContext, path: string) => (ctx.applyDecay({ path, score: 1 }) as { decay?: { multiplier: number; age_days: number; source: string } }).decay;

afterEach(async () => {
  process.env.PATH = origPath;
  vi.restoreAllMocks();
  await Promise.all(open_.splice(0).map((c) => c.flushIndex())); // a pending background save would race the cleanup
  await Promise.all(dirs.splice(0).map(cleanupTempDir));
});

describe("decay git fallback", () => {
  it("dates committed notes by their commit, penalizes untracked and edited ones, runs git once per build and reconcile, never per query", async () => {
    const calls = gitSpy();
    const dir = vault({
      "old.md": body("alpha"),
      "edited.md": body("beta"),
      "stamped.md": `---\nlast_verified: ${new Date().toISOString().slice(0, 10)}\n---\n${body("gamma")}`,
    });
    commit(dir, 400, "old.md", "edited.md", "stamped.md");
    await writeFile(join(dir, "edited.md"), body("beta") + "\nChanged after the commit.\n");
    await writeFile(join(dir, "untracked.md"), body("delta"));

    const ctx = await open(dir);
    const logs = () => calls().filter((c) => c.includes("log"));
    expect(logs()).toHaveLength(1);

    const old = decay(ctx, "old.md")!;
    expect(old.source).toBe("git");
    expect(old.age_days).toBeGreaterThanOrEqual(399);
    expect(old.multiplier).toBeCloseTo(Math.pow(0.5, old.age_days / 365), 2);
    expect(decay(ctx, "edited.md")).toMatchObject({ source: "penalty", multiplier: 0.85 });
    expect(decay(ctx, "untracked.md")).toMatchObject({ source: "penalty", multiplier: 0.85 });
    expect(decay(ctx, "stamped.md")!.source).toBe("last_verified"); // a usable last_verified is never replaced by git

    for (let i = 0; i < 5; i++) decay(ctx, "old.md");
    expect(logs()).toHaveLength(1); // queries never spawn git

    // committing the edit changes no bytes, so only the next reconcile that has something to do re-reads git dates
    commit(dir, 3, "edited.md", "untracked.md");
    await writeFile(join(dir, "new.md"), body("epsilon"));
    await ctx.reconcileNow();
    expect(logs()).toHaveLength(2);
    expect(decay(ctx, "edited.md")).toMatchObject({ source: "git" });
    expect(decay(ctx, "edited.md")!.age_days).toBeLessThan(5);
    expect(decay(ctx, "untracked.md")!.source).toBe("git");
    expect(decay(ctx, "new.md")!.source).toBe("penalty");

    await ctx.reconcileNow(); // nothing changed: no git
    expect(logs()).toHaveLength(2);
  }, 120_000);

  it("the CLI search ranks by the same decay and returns the same block", async () => {
    const dir = vault({ "old.md": body("alpha"), "other.md": body("beta") });
    commit(dir, 400, "old.md");
    const ctx = await open(dir);
    await ctx.flushIndex();
    const hits = await (await openSearch(dir)).search("alpha", 5);
    expect(hits.find((h) => h.path === "old.md")?.decay).toMatchObject({ source: "git" });
    expect(hits.find((h) => h.path === "other.md")?.decay).toMatchObject({ source: "penalty", multiplier: 0.85 });
  }, 120_000);

  it("a vault outside a git repo takes the penalty", async () => {
    const dir = vault({ "a.md": body("alpha") });
    expect(decay(await open(dir), "a.md")).toMatchObject({ source: "penalty", multiplier: 0.85 });
  }, 120_000);

  it("mtime mode ages by the doc's frontmatter date chain; fresh mode runs no git and attaches nothing", async () => {
    const calls = gitSpy();
    const dir = vault({ "a.md": `---\nlast_updated: ${new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10)}\n---\n${body("alpha")}`, "vault.schema.yml": "decay:\n  missing_last_verified: mtime\n" });
    const a = decay(await open(dir), "a.md")!;
    expect(a.source).toBe("mtime");
    expect(a.multiplier).toBeCloseTo(0.5, 1);

    await writeFile(join(dir, "vault.schema.yml"), "decay:\n  missing_last_verified: fresh\n");
    const fresh = await open(dir);
    expect(decay(fresh, "a.md")).toBeUndefined();
    expect(calls()).toHaveLength(0);
  }, 120_000);

  it("never reads last_validated", async () => {
    const dir = vault({ "a.md": `---\nlast_validated: ${new Date().toISOString().slice(0, 10)}\n---\n${body("alpha")}`, "vault.schema.yml": "decay:\n  missing_last_verified: penalty\n" });
    expect(decay(await open(dir), "a.md")!.source).toBe("penalty");
    expect(await readFile(join(dir, "a.md"), "utf-8")).toContain("last_validated");
  }, 120_000);

  it("an index from before gitDate (schema 5) is re-read, not re-embedded, and its docs get git dates", async () => {
    const dir = vault({ "a.md": body("alpha") });
    commit(dir, 400, "a.md");
    const first = await open(dir);
    await first.flushIndex();
    const metaPath = join(dir, ".semantic-sidekick-index", "meta.json");
    const docsPath = join(dir, ".semantic-sidekick-index", "docs.cache.json");
    await writeFile(metaPath, JSON.stringify({ ...JSON.parse(await readFile(metaPath, "utf-8")), schemaVersion: 5 }));
    await writeFile(docsPath, JSON.stringify(JSON.parse(await readFile(docsPath, "utf-8")).map(({ gitDate, ...d }: Record<string, unknown>) => d)));

    const ctx = await buildContext(dir, { reconcileThrottleMs: 0 });
    open_.push(ctx);
    const embedBatch = vi.spyOn(ctx.embedder, "embedBatch");
    expect(await ctx.tryLoadCachedIndex()).toBe(true);
    expect(decay(ctx, "a.md")).toMatchObject({ source: "penalty" }); // the old docs carry no date until the rebuild
    await ctx.fullIndex();
    expect(decay(ctx, "a.md")).toMatchObject({ source: "git" });
    expect(embedBatch).not.toHaveBeenCalled();
  }, 120_000);
});

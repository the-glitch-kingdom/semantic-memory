import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, utimes, chmod, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile, type Manifest } from "../../src/core/reconcile.js";
import { commitIndex, filesMatchMeta, readMeta, withLock, COMMIT_FILES } from "../../src/core/index-store.js";

describe("reconcile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reconcile-"));
    await writeFile(join(dir, "a.md"), "# A\n");
    await mkdir(join(dir, "sub"));
    await writeFile(join(dir, "sub", "b.md"), "# B\n");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("treats every file as new against an empty manifest", async () => {
    const plan = await reconcile(dir, {});
    expect(plan.parse.sort()).toEqual(["a.md", "sub/b.md"]);
    expect(plan.gone).toEqual([]);
    expect(plan.changed).toBe(true);
  });

  it("skips files whose stat is unchanged without reading them", async () => {
    const first = await reconcile(dir, {});
    const second = await reconcile(dir, first.manifest);
    expect(second.parse).toEqual([]);
    expect(second.changed).toBe(false);
    expect(second.manifest["a.md"]).toBe(first.manifest["a.md"]); // same object: never re-hashed
  });

  it("updates only the manifest when the stat changed but the bytes did not", async () => {
    const first = await reconcile(dir, {});
    await utimes(join(dir, "a.md"), new Date(), new Date(Date.now() + 5000));
    const second = await reconcile(dir, first.manifest);
    expect(second.parse).toEqual([]);
    expect(second.changed).toBe(true);
    expect(second.manifest["a.md"].contentHash).toBe(first.manifest["a.md"].contentHash);
    expect(second.manifest["a.md"].mtimeMs).not.toBe(first.manifest["a.md"].mtimeMs);
  });

  it("re-parses a file whose bytes changed, even when frontmatter dates did not", async () => {
    const first = await reconcile(dir, {});
    await writeFile(join(dir, "a.md"), "---\nlast_updated: 2020-01-01\n---\n# A changed\n");
    const second = await reconcile(dir, first.manifest);
    expect(second.parse).toEqual(["a.md"]);
  });

  it("reports deleted files as gone and drops them from the manifest", async () => {
    const first = await reconcile(dir, {});
    await unlink(join(dir, "sub", "b.md"));
    const second = await reconcile(dir, first.manifest);
    expect(second.gone).toEqual(["sub/b.md"]);
    expect(second.manifest["sub/b.md"]).toBeUndefined();
  });

  it("applies the shared ignore globs and ignores non-markdown", async () => {
    await mkdir(join(dir, "node_modules", "x"), { recursive: true });
    await writeFile(join(dir, "node_modules", "x", "readme.md"), "# dep");
    await writeFile(join(dir, "notes.txt"), "not markdown");
    const plan = await reconcile(dir, {});
    expect(plan.parse.sort()).toEqual(["a.md", "sub/b.md"]);
  });

  it("keeps the previous entry for an unreadable file instead of failing", async () => {
    const first = await reconcile(dir, {});
    await writeFile(join(dir, "a.md"), "# A edited\n");
    await chmod(join(dir, "a.md"), 0o000);
    try {
      const second = await reconcile(dir, first.manifest);
      if (process.getuid?.() === 0) return; // root reads anything
      expect(second.parse).not.toContain("a.md");
      expect(second.manifest["a.md"]).toEqual(first.manifest["a.md"]); // retried next time
      expect(second.gone).toEqual([]);
    } finally {
      await chmod(join(dir, "a.md"), 0o644);
    }
  });
});

describe("index store", () => {
  let dir: string;
  const info = { model: "m", dimensions: 2, totalChunks: 1 };
  const writeAll = (tag: string) => async (stage: string) => {
    for (const name of COMMIT_FILES) await writeFile(join(stage, name), `${tag}:${name}`);
  };
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "store-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("commits every file, meta last, and the result reads back as consistent", async () => {
    const meta = await commitIndex(dir, 0, info, writeAll("one"));
    expect(meta?.generation).toBe(1);
    expect(await filesMatchMeta(dir, (await readMeta(dir))!)).toBe(true);
    expect(await readFile(join(dir, "graph.json"), "utf-8")).toBe("one:graph.json");
  });

  it("detects a commit that died after renaming some files (mixed generations)", async () => {
    await commitIndex(dir, 0, info, writeAll("one"));
    const meta = (await readMeta(dir))!;
    await writeFile(join(dir, "docs.cache.json"), "two:docs.cache.json-longer"); // a second commit's file, meta never written
    expect(await filesMatchMeta(dir, meta)).toBe(false);
  });

  it("refuses to commit over a generation it did not read", async () => {
    await commitIndex(dir, 0, info, writeAll("one"));
    expect(await commitIndex(dir, 0, info, writeAll("two"))).toBeNull();
    expect((await readMeta(dir))?.generation).toBe(1);
    expect(await commitIndex(dir, 1, info, writeAll("two"))).not.toBeNull();
  });

  it("does not commit while a live process holds the lock", async () => {
    await writeFile(join(dir, "index.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));
    expect(await commitIndex(dir, 0, info, writeAll("one"))).toBeNull();
    expect(await readMeta(dir)).toBeNull();
  });

  it("takes over a lock left by a dead process", async () => {
    await writeFile(join(dir, "index.lock"), JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
    let ran = false;
    expect(await withLock(dir, async () => { ran = true; })).toBe(true);
    expect(ran).toBe(true);
  });

  it("takes over an unreadable lock file", async () => {
    await writeFile(join(dir, "index.lock"), "garbage");
    expect(await withLock(dir, async () => {})).toBe(true);
  });
});

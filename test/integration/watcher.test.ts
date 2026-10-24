import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Watcher } from "../../src/core/watcher.js";
import { createTempVault, cleanupTempDir } from "../setup.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";

// No skip-on-timeout: an earlier version treated a timeout as "events not available"
// and passed while the watcher received nothing at all (chokidar ≥4 dropped glob support, issue #29).

const DEBOUNCE_MS = 200;

function waitForChanged(watcher: Watcher, timeoutMs = 5_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Watcher timeout")), timeoutMs);
    watcher.on("changed", (paths) => {
      clearTimeout(timer);
      resolve(paths);
    });
  });
}

describe.each([
  { mode: "polling", usePolling: true },
  { mode: "native", usePolling: false },
])("Watcher ($mode)", ({ usePolling }) => {
  let tempDir: string;
  let watcher: Watcher;

  beforeEach(async () => {
    tempDir = await createTempVault();
    watcher = new Watcher(tempDir, DEBOUNCE_MS, usePolling);
  });

  afterEach(async () => {
    watcher.stop();
    await cleanupTempDir(tempDir);
  });

  it("should detect new files", async () => {
    watcher.start();
    await watcher.ready();

    const changed = waitForChanged(watcher);
    await writeFile(join(tempDir, "new-watched.md"), "# New\n\nWatched file.");
    const paths = await changed;
    expect(paths.some((p) => p.includes("new-watched.md"))).toBe(true);
  }, 15_000);

  it("should detect new files in subfolders", async () => {
    await mkdir(join(tempDir, "sub"), { recursive: true });
    watcher.start();
    await watcher.ready();

    const changed = waitForChanged(watcher);
    await writeFile(join(tempDir, "sub", "nested.md"), "# Nested");
    const paths = await changed;
    expect(paths.some((p) => p.includes("nested.md"))).toBe(true);
  }, 15_000);

  it("should detect modified files", async () => {
    watcher.start();
    await watcher.ready();

    const changed = waitForChanged(watcher);
    await writeFile(join(tempDir, "orphan.md"), "# Modified content");
    const paths = await changed;
    expect(paths.some((p) => p.includes("orphan.md"))).toBe(true);
  }, 15_000);

  it("should detect deleted files", async () => {
    watcher.start();
    await watcher.ready();

    const changed = waitForChanged(watcher);
    await unlink(join(tempDir, "orphan.md"));
    const paths = await changed;
    expect(paths.some((p) => p.includes("orphan.md"))).toBe(true);
  }, 15_000);

  it("should debounce rapid changes into a single event", async () => {
    let emitCount = 0;
    let lastPaths: string[] = [];

    watcher.on("changed", (paths) => {
      emitCount++;
      lastPaths = paths;
    });
    watcher.start();
    await watcher.ready();

    for (let i = 0; i < 5; i++) {
      await writeFile(join(tempDir, `rapid-${i}.md`), `# Rapid ${i}`);
    }

    await new Promise((r) => setTimeout(r, 1500));

    expect(emitCount).toBeGreaterThanOrEqual(1);
    expect(emitCount).toBeLessThanOrEqual(2);
    expect(lastPaths.length).toBeGreaterThan(0);
  }, 15_000);

  it("should ignore non-markdown files and index/vcs folders", async () => {
    for (const dir of [".semantic-sidekick-index", ".git", "node_modules"]) {
      await mkdir(join(tempDir, dir), { recursive: true });
    }
    let emitted = false;
    watcher.on("changed", () => { emitted = true; });
    watcher.start();
    await watcher.ready();

    await writeFile(join(tempDir, "ignored.txt"), "not markdown");
    await writeFile(join(tempDir, "ignored.png"), "not markdown");
    await writeFile(join(tempDir, ".semantic-sidekick-index", "x.md"), "index");
    await writeFile(join(tempDir, ".git", "x.md"), "vcs");
    await writeFile(join(tempDir, "node_modules", "x.md"), "dep");

    await new Promise((r) => setTimeout(r, 1000));
    expect(emitted).toBe(false);
  }, 15_000);

  it("should stop cleanly", () => {
    watcher.start();
    watcher.stop();
  });
});

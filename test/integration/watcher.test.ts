import { describe, it, expect } from "vitest";
import { Watcher } from "../../src/core/watcher.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

// The server no longer watches the tree (pull-based reconcile, see freshness.test.ts). The class stays
// exported for API compatibility until v2.0.0; the chokidar event tests went with the server's use of it.
describe("Watcher (deprecated export)", () => {
  it("still starts and stops cleanly", async () => {
    const dir = await createTempVault();
    const watcher = new Watcher(dir, 100, true);
    watcher.start();
    await watcher.ready();
    watcher.stop();
    await cleanupTempDir(dir);
  });
});

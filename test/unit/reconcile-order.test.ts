import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile } from "../../src/core/reconcile.js";

// parse order is the order docs enter the vector index; it came from stat/read completion order (#85)
it("returns files to parse sorted, not in I/O completion order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sp-rec-"));
  try {
    const names = Array.from({ length: 200 }, (_, i) => `n${String((i * 37) % 200).padStart(3, "0")}.md`);
    await Promise.all(names.map((n, i) => writeFile(join(dir, n), i % 5 === 0 ? "x".repeat(200_000) : "y")));
    const { parse } = await reconcile(dir, {});
    expect(parse).toEqual([...parse].sort());
    expect(parse).toHaveLength(200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

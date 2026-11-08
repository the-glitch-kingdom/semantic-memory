import { describe, it, expect, afterAll } from "vitest";
import { cp, chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../../src/mcp/context.js";
import { createSourceRegistry } from "../../src/mcp/sources.js";
import { cleanupTempDir, createTempVault } from "../setup.js";

const DOCS = join(__dirname, "..", "fixtures", "docs-vault");

/** every file and dir under d with its mtime */
function snapshot(d: string, out: Record<string, number> = {}): Record<string, number> {
  out[d] = statSync(d).mtimeMs;
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) snapshot(p, out);
    else out[p] = statSync(p).mtimeMs;
  }
  return out;
}

describe("federation source contexts", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await chmod(join(d, "locked"), 0o755).catch(() => {});
    await Promise.all(dirs.map(cleanupTempDir));
  });

  it("builds a source under the primary's index dir without touching the source, and reports skipped sources once", async () => {
    const primary = await createTempVault();
    const src = await mkdtemp(join(tmpdir(), "fed-src-"));
    dirs.push(primary, src);
    await cp(DOCS, src, { recursive: true });
    await mkdir(join(primary, "locked"));
    await chmod(join(primary, "locked"), 0o000);
    await writeFile(
      join(primary, "vault.schema.yml"),
      `federation:\n  related_repos: false\n  sources:\n    - {label: docs, path: ${src}}\n    - {label: gone, path: ${join(primary, "nope")}}\n    - {label: locked, path: ${join(primary, "locked")}}\n`,
    );
    const before = snapshot(src);

    const ctx = await buildContext(primary, { readOnly: true, telemetry: false });
    await ctx.embedder.init();
    const reg = createSourceRegistry(ctx);

    const first = await reg.open();
    expect(first.notes.some((n) => n.includes('"gone"') && n.includes("not found"))).toBe(true);
    expect(first.notes.some((n) => n.includes('"locked"'))).toBe(process.getuid?.() === 0 ? false : true);
    expect(first.notes.some((n) => n.includes('"docs"') && n.includes("still indexing"))).toBe(true);

    // the background first build finishes
    const deadline = Date.now() + 120_000;
    let ready = first.ready;
    while (ready.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      ready = (await reg.open()).ready;
    }
    expect(ready.map((h) => h.label)).toEqual(["docs"]);
    expect(ready[0].ctx.getDocuments().length).toBeGreaterThan(0);
    expect(ready[0].ctx.embedder).toBe(ctx.embedder);
    await ready[0].ctx.flushIndex();

    expect(ready[0].ctx.indexPath.startsWith(join(ctx.indexPath, "sources", "docs-"))).toBe(true);
    expect(existsSync(join(ready[0].ctx.indexPath, "meta.json"))).toBe(true);
    expect(snapshot(src)).toEqual(before);
    expect(existsSync(join(src, ".semantic-sidekick-index"))).toBe(false);

    // each skip is reported once per process
    expect((await reg.open()).notes).toEqual([]);
  }, 180_000);
});

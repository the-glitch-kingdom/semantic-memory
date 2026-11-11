import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, writeFile, readdir, symlink } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildContext, type ServerContext } from "../../src/mcp/context.js";
import { createSourceRegistry, type SourceHandle } from "../../src/mcp/sources.js";
import { coldChecksum } from "../../src/core/cold.js";
import { FIXTURES, GEN_A, GEN_B, FAKE_SECRET, allFileText, lockTree, makeProject, unlockTree, type Project } from "../long-term-fixture.js";

// Phase 4 of #93: opt-in sources are built only by openOptIn; locked ones never reconcile; checksum, secrets, archive.

const FED = "  related_repos: false\n  sources:\n    - {label: frozen, path: ../frozen-docs, default: false, locked: true}\n";

async function until(reg: ReturnType<typeof createSourceRegistry>, labels: string[], want: number) {
  const end = Date.now() + 150_000;
  for (;;) {
    const r = await reg.openOptIn(labels);
    if (r.ready.length >= want || Date.now() > end) return r;
    await new Promise((ok) => setTimeout(ok, 300));
  }
}
const paths = (h: SourceHandle) => h.ctx.getDocuments().map((d) => d.path);

describe("default traffic never builds an opt-in source", () => {
  let p: Project;
  let primary: ServerContext;
  beforeAll(async () => {
    p = await makeProject({ federation: FED });
    primary = await buildContext(p.docs, { telemetry: false });
  }, 120_000);
  afterAll(() => p.cleanup());

  it("open() leaves no directory under <primary index>/sources/", async () => {
    const reg = createSourceRegistry(primary);
    expect((await reg.open()).ready).toEqual([]);
    await reg.open();
    expect(existsSync(join(p.index, "sources")) ? await readdir(join(p.index, "sources")) : []).toEqual([]);
  });

  it("an unknown label is reported, primary and a default label are ignored", async () => {
    const reg = createSourceRegistry(primary);
    const r = await reg.openOptIn(["nope", "primary"]);
    expect(r).toMatchObject({ ready: [], unknown: ["nope"] });
  });
});

describe("cold generations", () => {
  let p: Project;
  let primary: ServerContext;
  beforeAll(async () => {
    p = await makeProject({ badChecksum: GEN_B });
    primary = await buildContext(p.docs, { telemetry: false });
  }, 120_000);
  afterAll(() => p.cleanup());

  it("long-term opens the good generation, skips the bad checksum with a one-line note, indexes archive/, never a secret file", async () => {
    const reg = createSourceRegistry(primary);
    const r = await until(reg, ["long-term"], 1);
    expect(r.ready.map((h) => h.label)).toEqual([`cold-${GEN_A}`]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatch(new RegExp(`^\\[federation: source "cold-${GEN_B}" skipped, checksum`));
    const docs = paths(r.ready[0]);
    expect(docs).toContain("archive/pelican-sharding-plan.md");
    expect(docs).not.toContain("operational/deploy-credentials.md");
    // the index of the verified generation is on disk, the refused one never built
    expect((await readdir(join(p.index, "sources"))).map((d) => d.split("-")[0] + "-" + d.split("-")[1]).sort()).toEqual([`cold-${GEN_A.slice(0, 4)}`]);
    expect(allFileText(join(p.index, "sources"))).not.toContain(FAKE_SECRET);
    expect(r.ready[0].ctx.getIndexState()).toBe("ready");
  }, 200_000);
});

describe("a locked source never reconciles", () => {
  let p: Project;
  let primary: ServerContext;
  const frozen = () => join(p.root, "frozen-docs");
  beforeAll(async () => {
    p = await makeProject({ federation: FED, cold: false });
    await cp(join(FIXTURES, "vault"), frozen(), { recursive: true });
    lockTree(frozen());
    primary = await buildContext(p.docs, { telemetry: false });
  }, 120_000);
  afterAll(async () => {
    unlockTree(frozen());
    await p.cleanup();
  });

  it("indexes under sourceIndexPath, answers from the old index after a change and says so", async () => {
    const reg = createSourceRegistry(primary);
    const first = await until(reg, ["frozen"], 1);
    expect(first.ready).toHaveLength(1);
    expect((await readdir(frozen())).includes(".semantic-sidekick-index")).toBe(false);
    await reg.openOptIn(["frozen"]); // records the checksum once the build is on disk

    unlockTree(frozen());
    await writeFile(join(frozen(), "newcomer.md"), "# Newcomer\n\nThe gryphon bridge handles overnight settlement.\n");
    const h = first.ready[0];
    await h.ctx.ensureFresh();
    await h.ctx.ensureFresh();
    expect(paths(h)).not.toContain("newcomer.md");
    const again = await reg.openOptIn(["frozen"]);
    expect(again.ready).toHaveLength(1);
    expect(again.notes[0]).toMatch(/changed/);
  }, 200_000);
});

describe("a symlink in a cold tree", () => {
  let p: Project;
  let primary: ServerContext;
  beforeAll(async () => {
    p = await makeProject({ lock: false });
    // a link out of the generation: the checksum hashes it as `link:` only, so the index must not follow it either
    const gen = join(p.coldRoot, GEN_A);
    await writeFile(join(p.root, "outside.md"), "# Outside\n\nZanzibar outside-the-generation marker text.\n");
    await symlink(join(p.root, "outside.md"), join(gen, "linked.md"));
    await symlink(p.legacy, join(gen, "linkdir"));
    const cfgPath = join(p.root, ".claude", "hit-em-with-the-docs.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.cold_storage.find((c: any) => c.generation === GEN_A).checksum = coldChecksum(gen);
    writeFileSync(cfgPath, JSON.stringify(cfg));
    primary = await buildContext(p.docs, { telemetry: false });
  }, 120_000);
  afterAll(() => p.cleanup());

  it("is neither followed nor indexed", async () => {
    const reg = createSourceRegistry(primary);
    const r = await until(reg, [`cold-${GEN_A}`], 1);
    const got = paths(r.ready[0]!);
    expect(got.length).toBeGreaterThan(0);
    expect(got.some((f) => f.startsWith("linkdir/") || f === "linked.md")).toBe(false);
  }, 200_000);
});

describe("verification holds on every call", () => {
  let p: Project;
  let primary: ServerContext;
  beforeAll(async () => {
    p = await makeProject({ lock: false });
    const cfgPath = join(p.root, ".claude", "hit-em-with-the-docs.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    delete cfg.cold_storage.find((c: any) => c.generation === GEN_B).checksum; // an unverifiable generation
    writeFileSync(cfgPath, JSON.stringify(cfg));
    primary = await buildContext(p.docs, { telemetry: false });
  }, 120_000);
  afterAll(() => p.cleanup());

  it("a generation without a checksum is never searched; one edited after it verified is refused on every later call", async () => {
    const reg = createSourceRegistry(primary);
    const first = await until(reg, ["long-term"], 1);
    expect(first.ready.map((h) => h.label)).toEqual([`cold-${GEN_A}`]);
    expect(first.notes.join()).toMatch(/has no checksum/);
    await writeFile(join(p.coldRoot, GEN_A, "added.md"), "# Added\n\nlate edit\n"); // moves the folder's mtime
    for (let i = 0; i < 3; i++) {
      const r = await reg.openOptIn([`cold-${GEN_A}`]);
      expect(r.ready).toEqual([]);
      expect(r.notes.join()).toMatch(/checksum does not match/);
    }
  }, 200_000);
});

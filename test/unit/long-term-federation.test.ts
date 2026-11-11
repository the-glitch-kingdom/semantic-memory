import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, realpath, cp } from "node:fs/promises";
import { join } from "node:path";
import { loadFederation } from "../../src/core/federation.js";
import { FIXTURES, GEN_A, GEN_B, makeProject, type Project } from "../long-term-fixture.js";

// #93 acceptance for the config side (Phase 3). `it.fails` = not implemented yet.

let p: Project;
beforeEach(async () => {
  p = await makeProject({ cold: false });
});
afterEach(() => p.cleanup());
const schema = (federation: string) => writeFile(join(p.docs, "vault.schema.yml"), `federation:\n${federation}`);
const hewtd = (cfg: unknown) => mkdir(join(p.root, ".claude"), { recursive: true }).then(() => writeFile(join(p.root, ".claude", "hit-em-with-the-docs.json"), JSON.stringify(cfg)));

describe("related_repos: opt-in", () => {
  const withSibling = async (mode: string) => {
    await cp(join(FIXTURES, "vault"), join(p.root, "sibling", ".documentation"), { recursive: true });
    await hewtd({ reconcile: { related_repos: [{ name: "sibling", path: "sibling" }] } });
    await schema(`  related_repos: ${mode}\n`);
    return "sibling";
  };

  it.fails("registers hewtd related repos as `default: false` sources", async () => {
    const name = await withSibling("opt-in");
    expect(loadFederation(p.docs).sources).toEqual([expect.objectContaining({ label: name, default: false })]);
  });

  it("true (the default) and false behave as today", async () => {
    const name = await withSibling("true");
    expect(loadFederation(p.docs).sources.map((s) => s.label)).toEqual([name]);
    await schema("  related_repos: false\n");
    expect(loadFederation(p.docs).sources).toEqual([]);
  });
});

describe("cold_storage in .claude/hit-em-with-the-docs.json", () => {
  it.fails("each valid entry becomes an opt-in, locked source `cold-<generation>` with historical metadata, checksum and secrets", async () => {
    const cp2 = await makeProject();
    try {
      const f = loadFederation(cp2.docs);
      expect(f.warnings).toEqual([]);
      expect(f.sources.map((s) => s.label)).toEqual([`cold-${GEN_A}`, `cold-${GEN_B}`]);
      expect(f.sources[0]).toMatchObject({
        path: await realpath(join(cp2.coldRoot, GEN_A)),
        default: false,
        locked: true,
        historical: { generation: GEN_A, source_commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", rotated_at: "2026-01-15T09:30:00Z" },
        secrets: ["operational/deploy-credentials.md"],
      });
      expect(typeof (f.sources[0] as any).checksum).toBe("string");
    } finally {
      await cp2.cleanup();
    }
  });

  it.fails("a malformed entry, a traversal path and a reserved label are warnings, never a throw", async () => {
    const bad = (generation: unknown, path: unknown) => ({ generation, path, source_commit: "x", rotated_at: "y", checksum: "z", secrets_findings: [] });
    await mkdir(join(p.root, ".documentation-cold", "2026-02-02"), { recursive: true });
    await hewtd({
      cold_storage: [
        bad("2026-02-02", ".documentation-cold/2026-02-02"),
        bad("bad label", ".documentation-cold/2026-02-02"),
        bad("2026-02-03", "../outside"),
        bad("2026-02-04", "/etc"),
        7,
      ],
    });
    const f = loadFederation(p.docs);
    expect(f.sources.map((s) => s.label)).toEqual(["cold-2026-02-02"]);
    expect(f.warnings.length).toBe(4);
  });

  it.fails("`primary` and `long-term` are reserved: a configured source using either is dropped with a warning", async () => {
    await mkdir(join(p.root, "x"));
    await schema("  related_repos: false\n  sources:\n    - {label: primary, path: ../x}\n    - {label: long-term, path: ../x}\n    - {label: fine, path: ../x}\n");
    const f = loadFederation(p.docs);
    expect(f.sources.map((s) => s.label)).toEqual(["fine"]);
    expect(f.warnings.length).toBe(2);
  });

  // holds today (the manifest is not read at all); guards the opt-out once it is
  it("`federation.cold_storage: false` opts out of reading the manifest", async () => {
    const cp2 = await makeProject({ federation: "  related_repos: false\n  cold_storage: false\n" });
    try {
      expect(loadFederation(cp2.docs).sources).toEqual([]);
    } finally {
      await cp2.cleanup();
    }
  });
});

describe("default and locked on a configured source", () => {
  it.fails("`default` is true unless `default: false`, `locked` is false unless `locked: true`; a bad value is dropped with a warning", async () => {
    await mkdir(join(p.root, "a"));
    await mkdir(join(p.root, "b"));
    await mkdir(join(p.root, "c"));
    await schema(
      "  related_repos: false\n  sources:\n    - {label: a, path: ../a}\n    - {label: b, path: ../b, default: false, locked: true}\n    - {label: c, path: ../c, default: maybe}\n",
    );
    const f = loadFederation(p.docs);
    expect(f.sources.find((s) => s.label === "a")).toMatchObject({ default: true, locked: false });
    expect(f.sources.find((s) => s.label === "b")).toMatchObject({ default: false, locked: true });
    expect(f.sources.some((s) => s.label === "c")).toBe(false);
    expect(f.warnings.length).toBe(1);
  });
});

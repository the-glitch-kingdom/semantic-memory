import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFederation } from "../../src/core/federation.js";

let root: string;
let vault: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "fed-")));
  vault = join(root, "app", "vault");
  await mkdir(vault, { recursive: true });
  await mkdir(join(root, ".git"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const schema = (yml: string) => writeFile(join(vault, "vault.schema.yml"), yml);
const hewtd = (cfg: unknown) =>
  mkdir(join(root, ".claude"), { recursive: true }).then(() => writeFile(join(root, ".claude", "hit-em-with-the-docs.json"), JSON.stringify(cfg)));

describe("loadFederation", () => {
  it("is empty with no schema and no hewtd config", () => {
    expect(loadFederation(vault)).toEqual({ sources: [], warnings: [] });
  });

  it("reads sources relative to the vault, defaulting label and weight", async () => {
    await mkdir(join(root, "other"));
    await schema("federation:\n  sources:\n    - path: ../../other\n    - {label: x, path: ../../other2, weight: 0.5}\n");
    const f = loadFederation(vault);
    expect(f.sources).toEqual([
      { label: "other", path: join(root, "other"), weight: 1 },
      { label: "x", path: join(root, "other2"), weight: 0.5 },
    ]);
  });

  it("drops bad entries with a warning, keeps good ones", async () => {
    await mkdir(join(root, "ok"));
    await schema(
      "federation:\n  sources:\n    - 7\n    - {label: a}\n    - {label: 'b c', path: ../../ok}\n    - {path: ../../ok, weight: -1}\n    - {path: ../../ok}\n",
    );
    const f = loadFederation(vault);
    expect(f.sources.map((s) => s.label)).toEqual(["ok"]);
    expect(f.warnings).toHaveLength(4);
  });

  it("survives malformed YAML and a non-list sources", async () => {
    await schema("federation: [unclosed\n");
    expect(loadFederation(vault).sources).toEqual([]);
    await schema("federation:\n  sources: nope\n");
    expect(loadFederation(vault).warnings).toHaveLength(1);
  });

  it("leaves out the primary and duplicates by realpath or label", async () => {
    await mkdir(join(root, "o"));
    await symlink(join(root, "o"), join(root, "link"));
    await schema(
      "federation:\n  sources:\n    - {label: self, path: .}\n    - {label: o, path: ../../o}\n    - {label: o2, path: ../../link}\n    - {label: o, path: ../../zzz}\n",
    );
    expect(loadFederation(vault).sources.map((s) => s.label)).toEqual(["o"]);
  });

  describe("related_repos", () => {
    it("resolves siblings' docs trees: own docs_root, else .documentation, else skipped", async () => {
      await mkdir(join(root, "a", "docs"), { recursive: true });
      await mkdir(join(root, "a", ".claude"), { recursive: true });
      await writeFile(join(root, "a", ".claude", "hit-em-with-the-docs.json"), JSON.stringify({ docs_root: "docs" }));
      await mkdir(join(root, "b", ".documentation"), { recursive: true });
      await mkdir(join(root, "c", "src"), { recursive: true });
      await hewtd({ reconcile: { related_repos: [{ name: "a", path: "a" }, { name: "b", path: "b" }, { name: "c", path: "c" }] } });
      const f = loadFederation(vault);
      expect(f.sources).toEqual([
        { label: "a", path: join(root, "a", "docs"), weight: 1 },
        { label: "b", path: join(root, "b", ".documentation"), weight: 1 },
      ]);
      expect(f.warnings).toHaveLength(1);
    });

    it("is off with related_repos: false, and ignores a malformed hewtd config", async () => {
      await mkdir(join(root, "b", ".documentation"), { recursive: true });
      await hewtd({ reconcile: { related_repos: [{ name: "b", path: "b" }, { name: "bad name", path: "b" }, 3] } });
      expect(loadFederation(vault).sources.map((s) => s.label)).toEqual(["b"]);
      await schema("federation:\n  related_repos: false\n");
      expect(loadFederation(vault).sources).toEqual([]);
      await writeFile(join(root, ".claude", "hit-em-with-the-docs.json"), "{not json");
      await rm(join(vault, "vault.schema.yml"));
      expect(loadFederation(vault)).toEqual({ sources: [], warnings: [] });
    });
  });
});

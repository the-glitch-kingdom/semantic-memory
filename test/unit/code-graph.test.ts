import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entityCard, splitUndocumented, groundDocs, loadExport, loadCodeData, fallbackCode, gitLastChanged } from "../../src/core/code-graph.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "code-graph-vault");
const mdIn = (dir: string) => new Set((readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".md")).map((f) => f.split("\\").join("/")));

let tmp: string;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "code-graph-"));
  warn = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); rmSync(tmp, { recursive: true, force: true }); });

const put = (rel: string, body: string) => { mkdirSync(join(tmp, rel, ".."), { recursive: true }); writeFileSync(join(tmp, rel), body); };
const exportOf = (g: unknown) => put(".hewtd/graph.json", typeof g === "string" ? g : JSON.stringify(g));
const doc = (over: object = {}) => ({ body_changed: "2026-01-10", verdict: "unreviewed", last_verified: null, refs: [], owner_of: [], points_to: [], duplicates: [], ...over });
const load = (docs: string[] = ["a.md"]) => loadExport(tmp, join(tmp, ".documentation"), new Set(docs));
let n = 0; // each case warns with its own text, so the once-per-message set never hides one
const uniq = () => `${tmp}-${n++}`;

describe("loadExport", () => {
  it("reads the fixture export and maps docs-relative keys to vault paths", () => {
    const vault = join(FIXTURE, ".documentation");
    const d = loadExport(FIXTURE, vault, mdIn(vault))!;
    expect(d.docs.size).toBe(Object.keys(JSON.parse(readFileSync(join(FIXTURE, ".hewtd", "graph.json"), "utf-8")).docs).length);
    const a = d.docs.get("operational/backup-pruning-b.md")!;
    expect(a).toMatchObject({ source: "export", refs: [{ kind: "file", target: "backend/jobs/prune_backups.py", resolved: true }, { kind: "symbol", file: "backend/jobs/prune_backups.py" }] });
    expect(a.refs[0].changed).toBeGreaterThan(a.bodyChanged!);
    expect(d.symbols.get("check_rls_coverage")).toMatchObject({ file: "backend/scripts/check_rls_coverage.py", citedBy: ["operational/row-security-audit.md"] });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a missing file is no export and says nothing", () => {
    expect(load()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("bad JSON, an unknown version or a non-object warn once and are ignored", () => {
    exportOf("{not json");
    expect(load()).toBeNull();
    expect(load()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    exportOf({ version: 2, docs: {}, symbols: {} });
    expect(load()).toBeNull();
    exportOf("[]");
    expect(load()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("skips unknown fields and malformed entries, keeps null resolved as null, drops non-code ref kinds", () => {
    put(".documentation/a.md", "x");
    exportOf({
      version: 1, future: true, symbols: { s: "bad", ok: { file: "./x.py", cited_by: ["a.md", 7, "gone.md"], extra: 1, file_kind: "definition" }, __proto__x: null },
      docs: {
        "a.md": doc({
          verdict: "bogus", body_changed: "yesterday", last_verified: "2026-02-03", surprise: 1,
          refs: [
            null, "str", { kind: "file" }, { kind: "env", target: "FOO", resolved: false }, { kind: "column", target: "t.c", resolved: false },
            { kind: "file", target: "./src/a.py", resolved: "yes", code_changed: "2026-03-01" },
            { kind: "file", target: "src/gone.py", resolved: false, code_changed: "nope" },
            { kind: "file", target: "src/unk.py", resolved: null },
            { kind: "symbol", target: "go", file: "src/a.py", repo: "sibling", resolved: true },
          ],
        }),
        "junk.md": 5,
        "__proto__": doc(),
      },
    });
    const d = load(["a.md", "junk.md"])!;
    const a = d.docs.get("a.md")!;
    expect(a.verdict).toBeUndefined();
    expect(a.bodyChanged).toBeUndefined();
    expect(a.lastVerified).toBe(Date.parse("2026-02-03"));
    expect(a.refs.map((r) => [r.kind, r.target, r.resolved])).toEqual([["file", "src/a.py", null], ["file", "src/gone.py", false], ["file", "src/unk.py", null], ["symbol", "go", true]]);
    expect(a.refs[0].changed).toBe(Date.parse("2026-03-01"));
    expect(a.refs[1].changed).toBeUndefined();
    expect(a.refs[3]).toMatchObject({ file: "src/a.py", repo: "sibling" });
    expect(d.docs.has("junk.md")).toBe(false);
    expect(d.symbols.has("s")).toBe(false);
    expect(d.symbols.get("ok")).toEqual({ file: "x.py", fileKind: "definition", citedBy: ["a.md"] });
  });

  it("maps keys through the export's docs_root, then the config's docs_root or docs_path, then .documentation", () => {
    exportOf({ version: 1, docs_root: "wiki", docs: { "a.md": doc() }, symbols: {} });
    expect(loadExport(tmp, join(tmp, "wiki"), new Set(["a.md"]))!.docs.has("a.md")).toBe(true);

    exportOf({ version: 1, docs: { "a.md": doc() }, symbols: {} });
    expect(loadExport(tmp, join(tmp, "docs"), new Set(["a.md"]))).toMatchObject({ docs: new Map() }); // default root .documentation is outside docs/: nothing matches
    for (const key of ["docs_path", "docs_root"]) {
      put(".claude/hit-em-with-the-docs.json", JSON.stringify({ [key]: "docs" }));
      expect(loadExport(tmp, join(tmp, "docs"), new Set(["a.md"]))!.docs.has("a.md"), key).toBe(true);
    }
    // a vault below the docs root: keys are re-based on it
    exportOf({ version: 1, docs: { "ops/a.md": doc(), "other/b.md": doc() }, symbols: {} });
    put(".claude/hit-em-with-the-docs.json", "{}");
    expect([...loadExport(tmp, join(tmp, ".documentation", "ops"), new Set(["a.md"]))!.docs.keys()]).toEqual(["a.md"]);
  });

  it("ignores the docs table, with one warning, when fewer than half the keys match", () => {
    const keys = ["a.md", "b.md", "c.md", "d.md"];
    exportOf({ version: 1, docs: Object.fromEntries(keys.map((k) => [k, doc()])), symbols: { s: { file: "f.py", cited_by: ["a.md"] } } });
    const d = load(["a.md"])!; // 1 of 4
    expect(d.docs.size).toBe(0);
    expect(d.symbols.get("s")!.citedBy).toEqual(["a.md"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(load(["a.md", "b.md"])!.docs.size).toBe(2); // exactly half is kept
  });
});

function repo() {
  const root = uniq();
  mkdirSync(root, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" });
  const commit = (date: string, rels: Record<string, string>) => {
    for (const [r, b] of Object.entries(rels)) { mkdirSync(join(root, r, ".."), { recursive: true }); writeFileSync(join(root, r), b); }
    git("add", "-A");
    execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "c"], { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  };
  git("init", "-q");
  return { root, commit };
}

describe("fallbackCode (no export)", () => {
  it("matches files, unique basenames and symbols; drops prose; flags only conservative dead refs", async () => {
    const { root, commit } = repo();
    commit("2026-01-01T00:00:00Z", { "backend/jobs/prune.py": "1", "scripts/ci/guards.sh": "1", "scripts/a/run.sh": "1", "scripts/b/run.sh": "1", ".documentation/ops/x.md": "x" });
    commit("2026-02-01T00:00:00Z", { "backend/jobs/prune.py": "2" });
    const refs = [
      "backend/jobs/prune.py", "guards.sh", "run.sh", "backend/jobs/gone.py", "read/write", "ops/gone.sh", "prune_job", "retryCount",
      "DATABASE_URL", "true", "crud.update", "../backend/jobs/prune.py", "../scripts/missing.sh", "../../outside/x.py", "backend/jobs", "./scripts/ci/guards.sh",
    ];
    const d = await fallbackCode(root, join(root, ".documentation"), [{ path: "ops/x.md", codeRefs: refs }, { path: "ops/none.md" }]);
    const got = d.docs.get("ops/x.md")!;
    expect(got.source).toBe("code-spans");
    expect(got.refs.map((r) => [r.kind, r.target, r.file, r.resolved])).toEqual([
      ["file", "backend/jobs/prune.py", "backend/jobs/prune.py", true],
      ["file", "guards.sh", "scripts/ci/guards.sh", true], // unique basename; "run.sh" has two and drops
      ["file", "backend/jobs/gone.py", undefined, false], // top folder backend/ exists
      ["symbol", "prune_job", undefined, null],
      ["symbol", "retryCount", undefined, null],
      ["file", "backend/jobs/prune.py", "backend/jobs/prune.py", true], // ../ from the vault
      ["file", "scripts/missing.sh", undefined, false],
      ["file", "backend/jobs", "backend/jobs", true],
      ["file", "scripts/ci/guards.sh", "scripts/ci/guards.sh", true],
    ]);
    expect(got.refs[0].changed).toBe(Date.parse("2026-02-01T00:00:00Z"));
    expect(got.refs[1].changed).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(got.refs[2].changed).toBeUndefined();
    expect(d.docs.has("ops/none.md")).toBe(false);
    expect(d.symbols.get("prune_job")).toEqual({ citedBy: ["ops/x.md"] });
  });

  it("is not fooled by line suffixes, folders with a slash, globs, placeholders or gitignored runtime paths", async () => {
    const { root, commit } = repo();
    commit("2026-01-01T00:00:00Z", { "src/core/vector.ts": "1", ".claude/settings.json": "{}", ".gitignore": ".claude/.semantic-memory/\n.planning/\n", ".documentation/a.md": "x" });
    const refs = ["src/core/vector.ts:73", "src/core/vector.ts:10-20", "src/core/vector.ts#L5", "src/core/vector.ts:CACHE_TTL_MS", "src/", "src/core/", "src/mcp/tools/*.ts",
      ".claude/skills/<name>/SKILL.md", ".claude/.semantic-memory/mode", ".claude/.semantic-memory", ".planning/", ".claude/gone.json"];
    const d = await fallbackCode(root, join(root, ".documentation"), [{ path: "a.md", codeRefs: refs }]);
    expect(d.docs.get("a.md")!.refs.map((r) => [r.target, r.resolved])).toEqual([
      ["src/core/vector.ts", true], ["src/core/vector.ts", true], ["src/core/vector.ts", true], ["src/core/vector.ts", true], ["src", true], ["src/core", true],
      [".claude/gone.json", false], // only a missing path git does not ignore is dead
    ]);
  });

  it("gitLastChanged dates files in batches past 500 pathspecs", async () => {
    const { root, commit } = repo();
    const files = Object.fromEntries(Array.from({ length: 520 }, (_, i) => [`f/${i}.txt`, "x"]));
    commit("2026-01-01T00:00:00Z", files);
    const m = await gitLastChanged(root, Object.keys(files));
    expect(m.size).toBe(520);
    expect(m.get("f/519.txt")).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });

  it("outside a repo there is nothing", async () => {
    mkdirSync(join(tmp, "v"), { recursive: true });
    const d = await fallbackCode(tmp, join(tmp, "v"), [{ path: "a.md", codeRefs: ["x/y.py", "do_thing"] }]);
    expect([...d.docs.get("a.md")!.refs.map((r) => r.target)]).toEqual(["do_thing"]);
  });
});

describe("loadCodeData", () => {
  it("is null outside a git repo (the graph stays doc-only)", async () => {
    expect(await loadCodeData(join(tmp), [{ path: "a.md", codeRefs: ["x_y"] }])).toBeNull();
  });

  it("uses the export for the docs it covers and the fallback for the rest", async () => {
    const { root, commit } = repo();
    commit("2026-01-01T00:00:00Z", { "src/a.py": "1", ".documentation/a.md": "x", ".documentation/b.md": "x" });
    mkdirSync(join(root, ".hewtd"), { recursive: true });
    writeFileSync(join(root, ".hewtd", "graph.json"), JSON.stringify({ version: 1, source_commit: null, docs: { "a.md": doc({ refs: [{ kind: "file", target: "src/a.py", resolved: true }] }) }, symbols: {} }));
    const d = (await loadCodeData(join(root, ".documentation"), [{ path: "a.md", codeRefs: ["nope_sym"] }, { path: "b.md", codeRefs: ["src/a.py", "nope_sym"] }]))!;
    expect(d.docs.get("a.md")!.source).toBe("export");
    expect(d.docs.get("b.md")!.source).toBe("code-spans");
    expect(d.symbols.get("nope_sym")!.citedBy).toEqual(["b.md"]); // a.md is covered by the export, whose refs win
  });
});

describe("groundDocs", () => {
  const D = (s: string) => Date.parse(s);
  const code = (over: object = {}) => ({
    docs: new Map([["a.md", { source: "export" as const, bodyChanged: D("2026-01-10"), refs: [
      { kind: "file" as const, target: "x.py", file: "x.py", resolved: true, changed: D("2026-02-01") },
      { kind: "file" as const, target: "old.py", resolved: false },
      { kind: "symbol" as const, target: "foo_bar", resolved: false },
    ], ...over }]]),
    symbols: new Map(),
  });
  it("reports files changed after the body date and dead file refs (not symbols), and clears when nothing is left", () => {
    const d: any = { path: "a.md" };
    expect(groundDocs([d], code())).toBe(true);
    expect(d.grounding).toEqual({ source: "export", code_drift: ["x.py"], dead_refs: ["old.py"] });
    expect(groundDocs([d], code())).toBe(false);
    expect(groundDocs([d], null)).toBe(true);
    expect(d.grounding).toBeUndefined();
  });
  it("a verification after the code change clears drift (export or frontmatter); no date means no drift claim", () => {
    const a: any = { path: "a.md" };
    groundDocs([a], code({ lastVerified: D("2026-03-01") }));
    expect(a.grounding.code_drift).toEqual([]);
    const b: any = { path: "a.md", frontmatter: { last_verified: "2026-03-01" } };
    groundDocs([b], code());
    expect(b.grounding.code_drift).toEqual([]);
    const c: any = { path: "a.md" };
    groundDocs([c], code({ bodyChanged: undefined }));
    expect(c.grounding.code_drift).toEqual([]);
    const e: any = { path: "a.md", gitDate: "2026-01-20T00:00:00Z" }; // fallback body date
    groundDocs([e], code({ bodyChanged: undefined }));
    expect(e.grounding.code_drift).toEqual(["x.py"]);
  });
  it("keeps hewtd's verdict (unreviewed is nothing)", () => {
    const d: any = { path: "a.md" };
    groundDocs([d], code({ verdict: "unreviewed", refs: [] }));
    expect(d.grounding).toBeUndefined();
    groundDocs([d], code({ verdict: "stale", refs: [] }));
    expect(d.grounding).toMatchObject({ verdict: "stale" });
  });
});

describe("entityCard and splitUndocumented", () => {
  const ref = (file: string) => ({ kind: "file" as const, target: file, file, resolved: true });
  const code: any = {
    files: ["jobs/a.py", "scripts/b.sh", "jobs/dup.py", "scripts/dup.py"],
    symbols: new Map([
      ["do_a", { file: "jobs/a.py", fileKind: "definition", citedBy: ["d1.md", "d2.md", "gone.md"] }],
      ["do_b", { file: "scripts/b.sh", fileKind: "reference", citedBy: [] }],
    ]),
    docs: new Map([["d1.md", { source: "export", refs: [ref("scripts/b.sh")] }]]),
  };
  const docs = new Map<string, any>([
    ["d1.md", { title: "One", grounding: { source: "export", code_drift: ["jobs/a.py"], dead_refs: [] } }],
    ["d2.md", { title: "Two" }],
  ]);
  it("says 'defined in' only for a definition, lists fresh citers first, and drops docs outside the vault", () => {
    expect(entityCard("where is do_a", code, docs, () => 0)).toEqual({
      entity: "do_a", kind: "symbol", path: "jobs/a.py", location: "defined in",
      cited_by: [{ path: "d2.md", title: "Two", stale: false }, { path: "d1.md", title: "One", stale: true }],
    });
    expect(entityCard("do_b", code, docs, () => 0)?.location).toBe("found in");
  });
  it("finds a unique file by name and its citers, never an ambiguous one", () => {
    expect(entityCard("scripts/b.sh", code, docs, () => 0)).toMatchObject({ kind: "file", path: "scripts/b.sh", cited_by: [{ path: "d1.md" }] });
    expect(entityCard("dup.py", code, docs, () => 0)).toBeUndefined();
    expect(entityCard("do_a", null, docs, () => 0)).toBeUndefined();
  });
  it("orders citers of equal freshness by search score", () => {
    const two = new Map(docs).set("d1.md", { title: "One" });
    expect(entityCard("do_a", code, two, (p) => (p === "d1.md" ? 2 : 1))?.cited_by.map((c) => c.path)).toEqual(["d1.md", "d2.md"]);
  });
  it("splits missing terms into those that exist in code (undocumented, with the file) and the rest", () => {
    expect(splitUndocumented(["b", "nowhere_fn"], code)).toEqual({ missing: ["nowhere_fn"], undocumented: [{ entity: "b", path: "scripts/b.sh" }] });
    expect(splitUndocumented(["x_y"], null)).toEqual({ missing: ["x_y"], undocumented: [] });
  });
});

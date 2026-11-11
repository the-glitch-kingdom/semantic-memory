import { describe, it, expect, afterEach } from "vitest";
import { cp, mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { openSearch } from "../../src/cli/search.js";
import { runHealthcheck } from "../../src/core/healthcheck.js";
import { cleanupTempDir } from "../setup.js";
import { gitHistory, stampDates } from "../retrieval-eval/git-history.js";
import { GEN_A, makeProject } from "../long-term-fixture.js";

// #95 acceptance: a hewtd export older than HEAD is detected, patched per ref and reported.

const X = "backend/scripts/export_audit_log.py"; // cited by D, resolved in the export
const Y = "backend/scripts/prune_backups.py"; // cited by D, with a code_changed date
const D = "operational/audit-export-a.md";
const E = "operational/cert-renewal-a.md"; // cites only renew_certs.py, which no case touches
const GONE = "operational/audit-export-b.md"; // its export ref backend/scripts/export_audit_log_old.py is dead
const QUERY = "audit export signed archive checksum secure share";
const QUERY_E = "certificate renewal";
const QUERY_GONE = "audit export old script";
const ZERO = "0".repeat(40);

let dirs: string[] = [];
let clients: Client[] = [];
let projects: Awaited<ReturnType<typeof makeProject>>[] = []; // read-only generations need their own unlock
afterEach(async () => {
  for (const c of clients) await c.close().catch(() => {});
  for (const d of dirs) await cleanupTempDir(d);
  for (const p of projects) await p.cleanup();
  dirs = [];
  clients = [];
  projects = [];
});

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } }).toString().trim();
const commit = (dir: string, msg: string) => { git(dir, "add", "-A", "--", ".", ":!.hewtd"); git(dir, "commit", "-q", "--allow-empty", "-m", msg); };

/** A temp git repo from code-graph-vault whose export (hewtd v1) is keyed to the commit it was written at; D cites X and Y. */
async function repo(opts: { graph?: boolean; commit?: string | null } = {}): Promise<{ dir: string; vault: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), "sp-stale-"));
  dirs.push(dir);
  await cp(join(import.meta.dirname, "..", "fixtures", "code-graph-vault"), dir, { recursive: true });
  await stampDates(dir);
  await gitHistory(dir);
  const head = git(dir, "rev-parse", "HEAD");
  const file = join(dir, ".hewtd", "graph.json");
  if (opts.graph === false) await rm(join(dir, ".hewtd"), { recursive: true });
  else {
    const g = JSON.parse(readFileSync(file, "utf-8"));
    g.source_commit = opts.commit === undefined ? head : opts.commit;
    g.docs[D].refs = [
      { code_changed: "2026-02-15", kind: "file", resolved: true, target: X },
      { code_changed: "2026-02-15", kind: "file", resolved: true, target: Y },
    ];
    for (const k of [D, E]) g.docs[k].verdict = "check"; // a shown verdict, so a doc without drift or dead refs still carries a grounding block
    await writeFile(file, JSON.stringify(g, null, 2));
  }
  return { dir, vault: join(dir, ".documentation"), head };
}

async function connect(vault: string): Promise<Client> {
  const server = await createServer(vault, { waitForReady: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "stale-graph", version: "1.0.0" });
  await client.connect(ct);
  clients.push(client);
  return client;
}

/** The grounding of `path` as search_hybrid and the CLI search return it for `query`, plus get_stats. */
async function observe(vault: string, path: string, query: string) {
  const client = await connect(vault);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((((await client.callTool({ name, arguments: args })).content) as { text: string }[])[0].text);
  const mcp = (await call("search_hybrid", { query, limit: 20 })).find((r: any) => r.path === path);
  const cli = (await (await openSearch(vault)).search(query, 20)).find((r) => r.path === path);
  expect(mcp, `${path} in search_hybrid`).toBeDefined();
  expect(cli, `${path} in CLI search`).toBeDefined();
  return { mcp: mcp.grounding, cli: (cli as any).grounding, stats: await call("get_stats", {}) };
}

describe("a stale code-graph export (#95)", () => {
  it("committed deletion of a cited file and edit of another: D lists the dead ref and the drift, no hewtd run", async () => {
    const r = await repo();
    await rm(join(r.dir, X));
    await appendFile(join(r.dir, Y), "\n# changed after the export\n");
    commit(r.dir, "delete x, edit y");
    const o = await observe(r.vault, D, QUERY);
    for (const g of [o.mcp, o.cli]) {
      expect(g?.dead_refs).toEqual([X]);
      expect(g?.code_drift).toEqual([Y]);
      expect(g).toMatchObject({ stale: true, source: "export+live" });
    }
  }, 300_000);
  it("a doc citing only unchanged files keeps source export and no stale (guard)", async () => {
    const r = await repo();
    await rm(join(r.dir, X));
    commit(r.dir, "delete x");
    const o = await observe(r.vault, E, QUERY_E);
    for (const g of [o.mcp, o.cli]) {
      expect(g?.source).toBe("export");
      expect(g).not.toHaveProperty("stale");
    }
  }, 300_000);

  it("get_stats.codeGraph reports export_commit, behind_head and files_changed_since", async () => {
    const r = await repo();
    await rm(join(r.dir, X));
    await appendFile(join(r.dir, Y), "\n# changed\n");
    commit(r.dir, "x and y");
    commit(r.dir, "empty");
    const { stats } = await observe(r.vault, E, QUERY_E);
    expect(stats.codeGraph).toMatchObject({ source: "export", export_commit: r.head, behind_head: 2, files_changed_since: 3 }); // x, y and the fixture's truth.json, which the first commit() sweeps in
  }, 300_000);

  it("export at HEAD: grounding is exactly the export's, so the release gate does not move (guard)", async () => {
    const r = await repo();
    const o = await observe(r.vault, D, QUERY);
    for (const g of [o.mcp, o.cli]) expect(g).toEqual({ source: "export", verdict: "check", code_drift: [], dead_refs: [] });
  }, 300_000);

  it("export at HEAD: get_stats reports export_commit, 0 behind and 0 files changed", async () => {
    const r = await repo();
    const { stats } = await observe(r.vault, D, QUERY);
    expect(stats.codeGraph).toMatchObject({ export_commit: r.head, behind_head: 0, files_changed_since: 0 });
  }, 300_000);

  it("a running server picks up a commit made after it started: the next search shows the dead ref", async () => {
    const r = await repo();
    const client = await connect(r.vault);
    const dead = async () => JSON.parse((((await client.callTool({ name: "search_hybrid", arguments: { query: QUERY, limit: 20 } })).content) as { text: string }[])[0].text).find((x: any) => x.path === D)?.grounding?.dead_refs;
    expect(await dead()).toEqual([]);
    await rm(join(r.dir, X));
    commit(r.dir, "delete x");
    let got: string[] | undefined;
    for (let i = 0; i < 20 && !got?.length; i++) { got = await dead(); if (!got?.length) await new Promise((res) => setTimeout(res, 500)); }
    expect(got).toEqual([X]);
  }, 300_000);

  it("an uncommitted deletion of a cited file is caught too (diff against the working tree)", async () => {
    const r = await repo();
    await rm(join(r.dir, X));
    const o = await observe(r.vault, D, QUERY);
    expect(o.mcp?.dead_refs).toEqual([X]);
    expect(o.cli?.dead_refs).toEqual([X]);
  }, 300_000);

  it("a dead ref in the export whose file now exists, untracked, is no longer dead", async () => {
    const r = await repo();
    commit(r.dir, "unrelated, so the export is behind");
    await writeFile(join(r.dir, "backend/scripts/export_audit_log_old.py"), "def export_audit_log_old(): pass\n");
    const o = await observe(r.vault, GONE, QUERY_GONE);
    expect(o.mcp?.dead_refs ?? []).toEqual([]);
    expect(o.cli?.dead_refs ?? []).toEqual([]);
  }, 300_000);

  it.each([["a commit git does not know", ZERO], ["null (an export made outside git)", null]])("source_commit is %s: every file ref is checked live, behind_head is unknown, nothing throws", async (_n, commitId) => {
    const r = await repo({ commit: commitId });
    await rm(join(r.dir, X));
    commit(r.dir, "delete x");
    const o = await observe(r.vault, D, QUERY);
    expect(o.mcp?.dead_refs).toEqual([X]);
    expect(o.cli?.dead_refs).toEqual([X]);
    expect(o.stats.codeGraph.behind_head).toBeNull();
  }, 300_000);

  it("no graph.json (a fresh clone): grounding and get_stats are what main gives (guard)", async () => {
    const r = await repo({ graph: false });
    const o = await observe(r.vault, D, QUERY);
    expect(Object.keys(o.stats.codeGraph).sort()).toEqual(["loadMs", "source"]);
    expect(o.stats.codeGraph.source).toBe("fallback");
    for (const g of [o.mcp, o.cli]) {
      expect(g?.source ?? "code-spans").toBe("code-spans");
      expect(g).not.toHaveProperty("stale");
    }
  }, 300_000);

  it("healthcheck reports a code-graph finding when the export is far behind HEAD, and none at HEAD", async () => {
    const found = (res: Awaited<ReturnType<typeof runHealthcheck>>) => res.findings.find((f) => /code[-_]?graph/i.test(f.check) && f.severity !== "ok");
    const r = await repo();
    expect(found(await runHealthcheck({ projectRoot: r.dir, tier: "fast", force: true }))).toBeUndefined(); // at HEAD
    for (let i = 0; i < 60; i++) commit(r.dir, `c${i}`); // CODE_GRAPH_STALE_COMMITS is below 60
    const f = found(await runHealthcheck({ projectRoot: r.dir, tier: "fast", force: true }));
    expect(f?.severity).toBe("warn");
    expect(`${f?.summary} ${f?.detail}`).toContain("npx hewtd index");
  }, 120_000);

  it("a locked (long-term) source gets no grounding from the live tree and no doc-key warning", async () => {
    const p = await makeProject();
    projects.push(p);
    git(p.root, "init", "-q");
    await mkdir(join(p.root, "backend"), { recursive: true });
    await writeFile(join(p.root, "backend", "live.py"), "x = 1\n");
    git(p.root, "config", "user.email", "t@example.invalid");
    git(p.root, "config", "user.name", "t");
    git(p.root, "add", "backend");
    git(p.root, "commit", "-q", "-m", "code");
    // the live export keys generation A's docs (so it would ground them) and none of generation B's (so it would warn)
    await mkdir(join(p.root, ".hewtd"));
    await writeFile(join(p.root, ".hewtd", "graph.json"), JSON.stringify({
      version: 1, source_commit: git(p.root, "rev-parse", "HEAD"), docs_root: `.documentation-cold/${GEN_A}`, symbols: {},
      docs: { "operational/skerry-cache-stampede.md": { body_changed: "2026-01-10", duplicates: [], last_verified: "2026-01-10", owner_of: [], points_to: [], verdict: "check", refs: [{ kind: "file", resolved: false, target: "backend/gone.py" }] } },
    }));
    // a first long-term search may only start the cold index in the background: search until the cold hits arrive
    let stderr = "";
    let cold: any[] = [];
    for (let i = 0; i < 4 && !cold.length; i++) {
      const r = spawnSync("node", [join(import.meta.dirname, "..", "..", "dist", "cli", "index.js"), "search", "request coalescing Skerry cache and the billing migration", "--notes", p.docs, "--source", "long-term", "--limit", "10"], { encoding: "utf8", timeout: 240_000 });
      expect(r.status, r.stderr).toBe(0);
      stderr += r.stderr;
      cold = (JSON.parse(r.stdout) as any[]).filter((h) => h.historical);
      if (!cold.length) await new Promise((res) => setTimeout(res, 5_000));
    }
    expect(cold.length).toBeGreaterThan(0);
    expect(stderr).not.toMatch(/fewer than half of its \d+ doc keys/);
    expect(cold.some((h) => h.grounding)).toBe(false);
  }, 300_000);
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openSearch } from "../../src/cli/search.js";

const ROOT = join(import.meta.dirname, "..", "..");
const CLI_PATH = join(ROOT, "dist", "cli", "index.js");
const SETS = ["absent-terms.jsonl", "absent-terms-heldout.jsonl"];

/**
 * #78 phase 5: one question, one answer. For every question of the absent-terms sets the stdio server, the CLI's searcher and a federated
 * server (this tree plus an identical source) give the same per-query flags, with and without the hewtd export.
 */
const questions = SETS.flatMap((f) =>
  readFileSync(join(ROOT, "test", "retrieval-eval", f), "utf-8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l).q as string),
);
const flags = (hits: any[]) => {
  const h = hits[0] ?? {};
  return { no_strong_match: h.no_strong_match, missing_terms: h.missing_terms, passing_terms: h.passing_terms, undocumented: h.undocumented };
};

const tmp: string[] = [];
/** a committed copy of this tree's docs and code, optionally with the export `hewtd index` writes */
function clone(exported: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "sp-parity-"));
  tmp.push(dir);
  for (const f of [".documentation", "src", "package.json"]) cpSync(join(ROOT, f), join(dir, f), { recursive: true });
  execFileSync("git", ["-C", dir, "init", "-q"]);
  if (exported) execFileSync(join(ROOT, "node_modules", ".bin", "hewtd"), ["index"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
  return dir;
}
async function connect(dir: string): Promise<Client> {
  const c = new Client({ name: "abstention-parity-test", version: "1.0.0" });
  // --wait-for-ready indexes the whole tree before answering initialize: the SDK's 60 s default timed out on CI
  await c.connect(new StdioClientTransport({ command: "node", args: [CLI_PATH, "--notes", ".documentation", "--read-only", "--no-watch", "--wait-for-ready"], cwd: dir, stderr: "ignore" }), { timeout: 300_000 });
  return c;
}
const ask = async (c: Client, q: string) => JSON.parse(((await c.callTool({ name: "search_hybrid", arguments: { query: q, limit: 5 } }, undefined, { timeout: 300_000 })) as any).content[0].text) as any[];

describe("abstention flags: same answer on every path", () => {
  const clients: Client[] = [];
  const mcp: Record<string, any[]> = {};
  const cli: Record<string, any[]> = {};
  let sourceAnswered = false;

  beforeAll(async () => {
    for (const exported of [false, true]) {
      const dir = clone(exported);
      const c = await connect(dir);
      clients.push(c);
      const searcher = await openSearch(join(dir, ".documentation"));
      const key = exported ? "export" : "plain";
      mcp[key] = [];
      cli[key] = [];
      for (const q of questions) {
        mcp[key].push(flags(await ask(c, q)));
        cli[key].push(flags(await searcher.search(q, 5)));
      }
    }
    const src = clone(false);
    const fed = clone(false);
    writeFileSync(join(fed, ".documentation", "vault.schema.yml"), `federation:\n  related_repos: false\n  sources:\n    - {label: twin, path: ${join(src, ".documentation")}}\n`);
    const c = await connect(fed);
    clients.push(c);
    // the source builds in the background: wait until it answers
    for (const end = Date.now() + 300_000; Date.now() < end; await new Promise((ok) => setTimeout(ok, 300))) {
      if ((await ask(c, "search")).some((h) => h.source === "twin")) { sourceAnswered = true; break; }
    }
    mcp.federated = [];
    for (const q of questions) mcp.federated.push(flags(await ask(c, q)));
  }, 900_000);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    for (const d of tmp) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  // Real-corpus slack: HNSW is random per build, so a borderline weak/strong call may differ between two builds; the term lists must not.
  const terms = (rows: ReturnType<typeof flags>[]) => rows.map(({ missing_terms, passing_terms, undocumented }) => ({ missing_terms, passing_terms, undocumented }));

  it.each(["plain", "export"])("stdio and the CLI agree (%s)", (arm) => {
    expect(terms(cli[arm])).toEqual(terms(mcp[arm]));
    expect(cli[arm].map((r) => r.no_strong_match).filter(Boolean).length).toBeGreaterThan(0);
    const differ = questions.filter((_, i) => cli[arm][i].no_strong_match !== mcp[arm][i].no_strong_match);
    expect(differ.length).toBeLessThanOrEqual(1);
  });

  it("the export does not change which names are missing", () => {
    expect(terms(mcp.export).map((r) => r.missing_terms)).toEqual(terms(mcp.plain).map((r) => r.missing_terms));
  });

  it("a federation with an identical source gives the single-tree answer", () => {
    expect(sourceAnswered).toBe(true); // else this compares the primary with itself
    expect(terms(mcp.federated).map((r) => r.missing_terms)).toEqual(terms(mcp.plain).map((r) => r.missing_terms));
    expect(terms(mcp.federated).map((r) => r.passing_terms)).toEqual(terms(mcp.plain).map((r) => r.passing_terms));
  });
});

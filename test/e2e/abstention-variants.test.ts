import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(import.meta.dirname, "..", "..");
const CLI_PATH = join(ROOT, "dist", "cli", "index.js");
const FIXTURE = join(ROOT, "test", "fixtures", "abstention-variants");
const HUBS = ["api/INDEX.md", "api/REGISTRY.md"];

/**
 * #78 phase 2, reproduced on a git repo built from test/fixtures/abstention-variants: hub files that name an absent product and
 * docs that spell a name with a hyphen, underscore or space, over stdio and the CLI.
 * `it.fails` marks what main gets wrong today; when a fix lands the case starts passing and becomes a plain `it`.
 */
const Q = {
  graphql: "How does the API handle GraphQL queries?", // named only in the two hubs
  autofill: "How does autofill work in the form helper?", // docs: auto-fill
  autoUnderscore: "How does the auto_fill helper behave?",
  autoPascal: "How does AutoFill pick the address?",
  retrybudget: "How is the retrybudget spent on a failed job?", // docs: retry_budget
  smartRetry: "How does the SmartRetry policy back off?", // docs: Smart Retry
  zustand: "Does the dashboard keep its state in Zustand?", // named only in package-lock.json
  temporal: "Which jobs run on Temporal?", // named only in service.toml
} as const;
type Name = keyof typeof Q;

/** per arm: the names main wrongly leaves unflagged (missing is expected for `absent`, not for `present`) */
const ABSENT: Name[] = ["graphql", "zustand", "temporal"];

const arms = [
  { arm: "hubs without generated:true, no export", flagged: false, exported: false },
  { arm: "hubs with generated:true, no export", flagged: true, exported: false },
  { arm: "hubs without generated:true, with export", flagged: false, exported: true },
  { arm: "hubs with generated:true, with export", flagged: true, exported: true },
];
/** what main gets wrong on this arm, recorded before any change (notes.md "Eval results: Phase 2") */
// Phase 3 fixed the hub-only product and Phase 4 the spelling variants: nothing is expected wrong any more.
const MAIN_WRONG = (_a: (typeof arms)[number]): Name[] => [];

describe.each(arms)("E2E #78: $arm", (a) => {
  let repo = "";
  let client: Client;
  const got = new Map<Name, { mcp: any[]; cli: any[] }>();

  const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  const hub = (rel: string) => {
    const body = readFileSync(join(FIXTURE, "docs", rel), "utf-8");
    return a.flagged ? `---\ngenerated: true\n---\n\n${body}` : body;
  };

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "sp-abstain-"));
    cpSync(join(FIXTURE, "docs"), join(repo, ".documentation"), { recursive: true });
    for (const f of ["src", "package-lock.json", "service.toml"]) cpSync(join(FIXTURE, f), join(repo, f), { recursive: true });
    for (const h of HUBS) writeFileSync(join(repo, ".documentation", h), hub(h));
    execFileSync("git", ["-C", repo, "init", "-q"]);
    if (a.exported) {
      // `hewtd index` writes .hewtd/graph.json but also rewrites every hub; put the fixture's hubs back so the arm tests the export, not the rewrite
      execFileSync(join(ROOT, "node_modules", ".bin", "hewtd"), ["index"], { cwd: repo, stdio: "ignore" });
      for (const h of HUBS) writeFileSync(join(repo, ".documentation", h), hub(h));
    }
    git("add", "-A");
    git("commit", "-qm", "init");
    client = new Client({ name: "abstention-variants-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "node", args: [CLI_PATH, "--notes", ".documentation", "--read-only", "--no-watch", "--wait-for-ready"], cwd: repo, stderr: "ignore" }));
    for (const name of Object.keys(Q) as Name[]) {
      const res: any = await client.callTool({ name: "search_hybrid", arguments: { query: Q[name], limit: 5 } });
      const { stdout } = await promisify(execFile)("node", [CLI_PATH, "search", Q[name], "--notes", ".documentation", "--limit", "5"], { cwd: repo });
      got.set(name, { mcp: JSON.parse(res.content[0].text), cli: JSON.parse(stdout) });
    }
  }, 240_000);

  afterAll(async () => {
    await client?.close();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const missing = (name: Name, via: "mcp" | "cli"): string[] => got.get(name)![via][0].missing_terms ?? [];

  for (const name of Object.keys(Q) as Name[]) {
    const expectMissing = ABSENT.includes(name);
    const wrongOnMain = MAIN_WRONG(a).includes(name);
    for (const via of ["mcp", "cli"] as const) {
      const test = wrongOnMain ? it.fails : it;
      test(`${name} over ${via}: ${expectMissing ? "is in missing_terms" : "is not in missing_terms"}`, () => {
        const m = missing(name, via).map((t) => t.toLowerCase());
        if (expectMissing) expect(m).toContain(Q[name].match(/\b(GraphQL|Zustand|Temporal)\b/)![0].toLowerCase());
        else expect(m).toEqual([]);
      });
    }
  }

  it("stdio and the CLI agree on every query", () => {
    for (const name of Object.keys(Q) as Name[]) {
      const { mcp, cli } = got.get(name)!;
      expect(cli.map((h) => [h.path, h.no_strong_match, h.missing_terms])).toEqual(mcp.map((h) => [h.path, h.no_strong_match, h.missing_terms]));
    }
  });
});

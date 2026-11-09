import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI_PATH = join(import.meta.dirname, "..", "..", "dist", "cli", "index.js");

/**
 * #73: the plugin starts the server and an agent queries at once. Without `.hewtd/graph.json` the code graph is built from
 * `git log`; a slow `git log` must not leave the first answers without doc metadata (titles, status, filters, generated/excluded docs).
 */
describe("E2E: first answer from the stdio server while `git log` is slow", () => {
  let repo = "";
  let shim = "";
  let client: Client;

  const put = (rel: string, body: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body); };
  /** The first parseable answer: the server says "Indexing in progress" until its vector index exists. */
  const firstAnswer = async (args: Record<string, unknown>) => {
    for (const deadline = Date.now() + 120_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 100))) {
      const res: any = await client.callTool({ name: "search_hybrid", arguments: { query: "How are releases cut with the deploy script?", limit: 5, full: true, ...args } });
      try { const p = JSON.parse(res.content[0].text); if (Array.isArray(p)) return p as any[]; } catch { /* not ready */ }
    }
    throw new Error("no answer in 120 s");
  };

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "sp-load-gap-"));
    shim = mkdtempSync(join(tmpdir(), "sp-git-shim-"));
    const git = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
    writeFileSync(join(shim, "git"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = log ] && sleep 30 && break; done\nexec ${git} "$@"\n`);
    chmodSync(join(shim, "git"), 0o755);
    put("src/deploy.ts", "export const deploy = () => {};\n");
    put(".documentation/release-guide.md", "---\ntitle: Release Guide\nstatus: active\nload_priority: 8\n---\n# Release Guide\n\nReleases are cut with the deploy script in `src/deploy.ts`: tag, build, publish.\n");
    put(".documentation/release-draft.md", "---\ntitle: Release Draft\nstatus: draft\n---\n# Release Draft\n\nNotes on how releases are cut with the deploy script in `src/deploy.ts`, not final.\n");
    put(".documentation/release-generated.md", "---\ntitle: Release Generated\ngenerated: true\n---\n# Release Generated\n\nGenerated listing: how releases are cut with the deploy script `src/deploy.ts`.\n");
    put(".documentation/archive/release-old.md", "# Release Old\n\nHow releases were cut with the deploy script `src/deploy.ts` before the rewrite.\n");
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    // the index exists before the server starts, as after the first session: only the doc metadata load is under test
    execFileSync("node", [CLI_PATH, "--notes", ".documentation", "--reindex"], { cwd: repo, stdio: "ignore", timeout: 170_000 });
    client = new Client({ name: "stdio-load-gap-test", version: "1.0.0" });
    // the plugin's launch: no --wait-for-ready, cwd = the repo, no export
    await client.connect(new StdioClientTransport({ command: "node", args: [CLI_PATH, "--notes", ".documentation", "--read-only"], cwd: repo, env: { ...process.env, PATH: `${shim}:${process.env.PATH}` } as Record<string, string>, stderr: "ignore" }));
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    for (const d of [repo, shim]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("the first answer carries titles, load_priority and status, and never a generated or excluded doc", async () => {
    const res = await firstAnswer({});
    const guide = res.find((r) => r.path === "release-guide.md");
    expect(guide).toMatchObject({ title: "Release Guide", status: "active", loadPriority: 8 });
    expect(res.map((r) => r.path).filter((p) => p.startsWith("archive/") || p === "release-generated.md")).toEqual([]);
  }, 150_000);

  it("the first answer honours the status filter", async () => {
    const res = await firstAnswer({ status: "active" });
    expect(res.map((r) => r.path)).toEqual(["release-guide.md"]);
  }, 150_000);
});

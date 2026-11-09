import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI_PATH = join(import.meta.dirname, "..", "..", "dist", "cli", "index.js");

/** #71: the plugin's launch (`--notes .documentation --read-only`, cwd = a git repo) must give the entity card, `related` and the section fields. */
describe("E2E: stdio --read-only server in a git repo", () => {
  let repo = "";
  let client: Client;

  const put = (rel: string, body: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body); };
  const search = async (query: string) => {
    const res: any = await client.callTool({ name: "search_hybrid", arguments: { query, limit: 5 } });
    return JSON.parse(res.content[0].text) as any[];
  };

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "sp-stdio-ro-"));
    put("src/TaskResponse.ts", "export class TaskResponse {}\n");
    put(".documentation/queue.md", "# Queue worker\n\n## Replies\n\nThe queue worker answers every job with `src/TaskResponse.ts`, the reply envelope. See [[retries]] and [[dead-letters]].\n");
    put(".documentation/retries.md", "# Queue retries\n\nThe queue worker retries a failed job three times with backoff. Back to [[queue]].\n");
    put(".documentation/dead-letters.md", "# Queue dead letters\n\nA job the queue worker could not finish after its retries goes to the dead letter list. Back to [[queue]].\n");
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    client = new Client({ name: "stdio-readonly-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "node", args: [CLI_PATH, "--notes", ".documentation", "--read-only", "--no-watch", "--wait-for-ready"], cwd: repo, stderr: "ignore" }));
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("a PascalCase name the code has gets the entity card and is classified as an identifier", async () => {
    const top = (await search("What does TaskResponse carry back to the caller?"))[0];
    expect(top.entity).toMatchObject({ entity: "TaskResponse", kind: "file", path: "src/TaskResponse.ts" });
    expect(top.entity.cited_by.map((c: any) => c.path)).toEqual(["queue.md"]);
    expect(top.query_type).toBe("identifier");
  }, 60_000);

  it("a prose PascalCase word the code does not have stays prose", async () => {
    const top = (await search("When does SessionEnd fire for the queue worker?"))[0];
    expect(top.entity).toBeUndefined();
    expect(top.query_type).not.toBe("identifier");
  }, 60_000);

  it("#1 carries related docs and the section fields without an export", async () => {
    const top = (await search("How does the queue worker answer a job?"))[0];
    expect(top.path).toBe("queue.md");
    expect(top.related?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(top.section).toBeTruthy();
    expect(top.anchor).toBeTruthy();
  }, 60_000);

  it("an absent vendor name is flagged the same over stdio and the CLI (#74)", async () => {
    const q = "How does the queue worker send jobs to Hotjar?";
    const mcp = await search(q);
    const { stdout } = await promisify(execFile)("node", [CLI_PATH, "search", q, "--notes", ".documentation", "--limit", "5"], { cwd: repo });
    const cli = JSON.parse(stdout) as any[];
    expect(mcp[0]).toMatchObject({ no_strong_match: true, missing_terms: ["Hotjar"] });
    expect(cli.map((h) => [h.no_strong_match, h.missing_terms])).toEqual(mcp.map((h) => [h.no_strong_match, h.missing_terms]));
    expect(cli.map((h) => h.path)).toEqual(mcp.map((h) => h.path));
  }, 60_000);
});

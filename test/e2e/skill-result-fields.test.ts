import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// keep in step with RESULT_FIELDS in test/unit/skill-surfaces.test.ts
const RESULT_FIELDS = ["missing_terms", "undocumented", "passing_terms", "no_strong_match", "decay", "entity", "related"];
const CLI_PATH = join(import.meta.dirname, "..", "..", "dist", "cli", "index.js");

/**
 * #81: the result fields skills/semantic-first teaches must appear in a real search_hybrid response from a built server,
 * not just in the source. One small git repo, one question per field.
 */
describe("E2E: result fields the semantic-first skill names", () => {
  let repo = "";
  let client: Client;
  const put = (rel: string, body: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), body); };
  const search = async (query: string) => JSON.parse(((await client.callTool({ name: "search_hybrid", arguments: { query, limit: 5 } })) as any).content[0].text) as any[];
  const seen = new Set<string>();
  const collect = (hits: any[]) => hits.forEach((h) => Object.keys(h).forEach((k) => seen.add(k)));

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "sp-skill-fields-"));
    put("src/TaskResponse.ts", "export class TaskResponse {}\n");
    put("src/DeadLetterSweeper.ts", "export class DeadLetterSweeper {}\n");
    put(".documentation/queue.md", "# Queue worker\n\n## Replies\n\nThe queue worker answers every job with `src/TaskResponse.ts`, the reply envelope. See [[retries]] and [[dead-letters]].\n");
    put(".documentation/retries.md", "# Queue retries\n\nThe queue worker retries a failed job three times with backoff. Back to [[queue]].\n");
    put(".documentation/dead-letters.md", "# Queue dead letters\n\nA job the queue worker could not finish after its retries goes to the dead letter list. Back to [[queue]].\n");
    put(".documentation/old.md", "---\ntitle: Zephyr flux capacitor\nstatus: active\ntype: gotcha\nlast_verified: 2019-01-01\n---\n\n# Zephyr flux capacitor calibration\n\nZephyr flux capacitor calibration procedure. Errors go to Sentry.\n");
    execFileSync("git", ["-C", repo, "init", "-q"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    client = new Client({ name: "skill-fields-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "node", args: [CLI_PATH, "--notes", ".documentation", "--read-only", "--no-watch", "--wait-for-ready"], cwd: repo, stderr: "ignore" }));
    for (const q of [
      "How does the queue worker answer a job?", // related
      "What does TaskResponse carry back to the caller?", // entity
      "How does the queue worker send jobs to Hotjar?", // no_strong_match, missing_terms
      "What does DeadLetterSweeper do?", // undocumented
      "How does the queue worker retry a failed job with Sentry?", // passing_terms: Sentry is in one doc, and not a top result
      "zephyr flux capacitor calibration", // decay
    ]) collect(await search(q));
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each(RESULT_FIELDS)("a real search_hybrid response carries `%s`", (field) => {
    expect(seen).toContain(field);
  }, 60_000);

  it("search_hybrid takes `limit`, not top_k", async () => {
    const tool = (await client.listTools()).tools.find((t) => t.name === "search_hybrid")!;
    expect(Object.keys((tool.inputSchema as any).properties)).toContain("limit");
    expect(Object.keys((tool.inputSchema as any).properties)).not.toContain("top_k");
  });
});

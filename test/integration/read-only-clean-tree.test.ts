import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { readSelectionLog } from "../../src/core/telemetry.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf-8" });

describe("--read-only server", () => {
  let dir: string;
  afterAll(async () => dir && (await cleanupTempDir(dir)));

  it("leaves a git-tracked notes tree clean after searches and reads, and logs under the index dir", async () => {
    dir = await createTempVault();
    // the index dir is the one place a read-only server may write; a real tree ignores it
    writeFileSync(join(dir, ".gitignore"), ".semantic-sidekick-index/\n");
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");

    const server = await createServer(dir, { watch: false, waitForReady: true, readOnly: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(ct);

    const text = async (name: string, args: Record<string, unknown>) =>
      ((await client.callTool({ name, arguments: args })) as any).content[0].text as string;
    const hits = JSON.parse(await text("search_semantic", { query: "project notes" }));
    await text("search_hybrid", { query: "project notes" });
    await text("search_text", { query: "the" });
    await text("get_stats", {});
    await text("read_note", { path: hits[0].path });
    await client.close();

    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(existsSync(join(dir, ".semantic-sidekick-index", "selection.jsonl"))).toBe(true);
    // usage-boost reads it back
    expect((await readSelectionLog(dir)).some((e) => e.kind === "selection")).toBe(true);
  }, 180_000);

  it("still reads the legacy selection log", async () => {
    const d = await createTempVault();
    mkdirSync(join(d, ".claude", ".semantic-memory"), { recursive: true });
    writeFileSync(join(d, ".claude", ".semantic-memory", "selection.jsonl"), JSON.stringify({ kind: "selection", note_path: "a.md", via: "read_note" }) + "\n");
    expect(await readSelectionLog(d)).toHaveLength(1);
    await cleanupTempDir(d);
  });
});

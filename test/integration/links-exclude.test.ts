import { describe, it, expect, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

describe("backlinks / forwardlinks and path_class.exclude", () => {
  let dir: string;
  afterAll(async () => dir && (await cleanupTempDir(dir)));

  it("hide archived neighbours unless asked; supersedes stays reachable; graph_path goes either way", async () => {
    dir = await createTempVault();
    await mkdir(join(dir, "archive"), { recursive: true });
    await writeFile(join(dir, "live-x.md"), "# Live X\n\nSee [old](archive/old-x.md).\n");
    await writeFile(join(dir, "archive", "old-x.md"), "# Old X\n\nOlder copy of [live](../live-x.md).\n");
    const server = await createServer(dir, { watch: false, waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1" });
    await client.connect(ct);
    const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })) as any).content[0].text as string;
    const paths = async (name: string, args: Record<string, unknown>) => (JSON.parse(await call(name, args)) as { path: string }[]).map((n) => n.path);

    expect(await paths("forwardlinks", { path: "live-x.md" })).not.toContain("archive/old-x.md");
    expect(await paths("forwardlinks", { path: "live-x.md", include_excluded: true })).toContain("archive/old-x.md");
    expect(await paths("backlinks", { path: "live-x.md" })).not.toContain("archive/old-x.md");
    expect(await paths("backlinks", { path: "live-x.md", include_excluded: true })).toContain("archive/old-x.md");
    expect(JSON.parse(await call("graph_path", { from: "live-x.md", to: "archive/old-x.md", direction: "in" }))).toEqual(["live-x.md", "archive/old-x.md"]);
    await client.close();
  }, 180_000);
});

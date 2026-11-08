import { describe, it, expect, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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

    // an archived note must not bridge two live ones unless supersedes is asked for
    await writeFile(join(dir, "live-a.md"), "# Live A\n\nAlpha note.\n");
    await writeFile(join(dir, "live-b.md"), "# Live B\n\nBeta note.\n");
    await writeFile(join(dir, "archive", "bridge.md"), "# Bridge\n\nSee [a](../live-a.md) and [b](../live-b.md).\n");
    await call("reindex", {});
    expect(await call("graph_path", { from: "live-a.md", to: "live-b.md" })).toBe("No path found");
    expect(JSON.parse(await call("graph_path", { from: "live-a.md", to: "live-b.md", types: ["link", "supersedes"] }))).toEqual(["live-a.md", "archive/bridge.md", "live-b.md"]);
    await client.close();
  }, 180_000);

  it("keeps a cited code file whose path has an archive/ folder", async () => {
    const vault = await createTempVault();
    try {
      await mkdir(join(vault, "tools", "archive"), { recursive: true });
      await writeFile(join(vault, "tools", "archive", "old.sh"), "echo\n");
      await writeFile(join(vault, "live.md"), "# Live\n\nRuns [old](tools/archive/old.sh).\n");
      const git = (...a: string[]) => execFileSync("git", ["-C", vault, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { stdio: "pipe" });
      git("init", "-q"); git("add", "-A"); git("commit", "-qm", "c");
      const server = await createServer(vault, { watch: false, waitForReady: true });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const client = new Client({ name: "t", version: "1" });
      await client.connect(ct);
      const r = (await client.callTool({ name: "forwardlinks", arguments: { path: "live.md" } })) as any;
      expect(JSON.parse(r.content[0].text).map((n: { path: string }) => n.path)).toEqual(["code:tools/archive/old.sh"]);
      await client.close();
    } finally {
      await cleanupTempDir(vault);
    }
  }, 180_000);
});

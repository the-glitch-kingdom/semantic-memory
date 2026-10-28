import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { relative } from "node:path";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

// v1.7.2: Claude Code loads server instructions at session start even while the tools are deferred, and keeps a
// tool flagged anthropic/alwaysLoad out of tool search.
describe("server instructions and the always-loaded search tool", () => {
  const dirs: string[] = [];
  async function connect(readOnly: boolean) {
    const dir = await createTempVault();
    dirs.push(dir);
    const server = await createServer(dir, { watch: false, readOnly });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "instructions-test", version: "1.0.0" });
    await client.connect(clientTransport);
    return { client, where: relative(process.cwd(), dir) || dir };
  }
  afterAll(async () => {
    for (const d of dirs) await cleanupTempDir(d);
  });

  it("a read-only docs server names its folder and says to search before grepping", async () => {
    const { client, where } = await connect(true);
    const text = client.getInstructions() ?? "";
    expect(text).toContain(`indexes ${where} (markdown, read-only)`);
    expect(text).toContain("call search_hybrid here before grepping");
    expect(text).not.toContain("synthesize_note");
    expect(text.length).toBeLessThan(4096); // Claude Code truncates server instructions past 4,096 chars
    await client.close();
  }, 120_000);

  it("a writable vault server also says where research goes", async () => {
    const { client } = await connect(false);
    expect(client.getInstructions()).toContain("synthesize_note");
    await client.close();
  }, 120_000);

  it("flags search_hybrid, and only it, as always loaded", async () => {
    const { client } = await connect(false);
    const { tools } = await client.listTools();
    const flagged = tools.filter((t) => (t._meta as Record<string, unknown> | undefined)?.["anthropic/alwaysLoad"] === true);
    expect(flagged.map((t) => t.name)).toEqual(["search_hybrid"]);
    await client.close();
  }, 120_000);
});

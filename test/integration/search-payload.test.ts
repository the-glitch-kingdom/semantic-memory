import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";

// Phase 7: trimmed default payload, `full: true` keeps the old shape, weak top results carry no_strong_match.
describe("search payload and abstention", () => {
  let client: Client;
  let dir: string;
  const call = async (name: string, args: Record<string, unknown>) =>
    JSON.parse(((await client.callTool({ name, arguments: args })).content as any)[0].text) as any[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-payload-"));
    await cp(join(import.meta.dirname, "..", "fixtures", "docs-vault"), dir, { recursive: true });
    const server = await createServer(dir, { watch: false, waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "payload", version: "1.0.0" });
    await client.connect(ct);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    if (dir) await cleanupTempDir(dir);
  });

  for (const tool of ["search_hybrid", "search_semantic"]) {
    it(`${tool}: default is trimmed, full keeps the whole result`, async () => {
      const q = "What does the harbor.dlq topic receive?";
      const [trim] = await call(tool, { query: q, limit: 3 });
      expect(Object.keys(trim).sort()).toEqual(expect.arrayContaining(["confidence", "path", "score", "snippet", "title"]));
      expect(trim.matchedChunk).toBeUndefined();
      expect(trim.mtime).toBeUndefined();
      expect(trim.snippet.length).toBeLessThanOrEqual(604);
      expect(trim.no_strong_match).toBeUndefined();

      const [full] = await call(tool, { query: q, limit: 3, full: true });
      expect(full.path).toBe(trim.path);
      expect(typeof full.matchedChunk).toBe("string");
      expect(full.mtime).toBeDefined();
      expect(full.confidence).toBe(trim.confidence);
      expect(full.cosine).toBeUndefined(); // internal signals never leave the server
    });
  }

  it("an off-topic question flags every result no_strong_match, in both shapes", async () => {
    const q = "What is the recipe for the crew canteen fish stew?";
    for (const full of [false, true]) {
      const rs = await call("search_hybrid", { query: q, limit: 4, full });
      expect(rs.length).toBeGreaterThan(0);
      expect(rs.every((r) => r.no_strong_match === true)).toBe(true);
    }
  });
});

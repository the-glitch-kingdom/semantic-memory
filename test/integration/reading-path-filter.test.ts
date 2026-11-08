import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, readdir, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";

// #61: reading_path members that were not search hits obey the same filters as the hits; works on a doc-only graph (no .hewtd/graph.json).
describe("reading_path and search filters", () => {
  let client: Client;
  let dir: string;
  const q = "Walk me through how a reading travels from the edge agent to an alert, end to end";
  const pathOf = async (extra: Record<string, unknown> = {}) =>
    ((JSON.parse(((await client.callTool({ name: "search_hybrid", arguments: { query: q, limit: 5, ...extra } })).content as any)[0].text) as any[])[0]?.reading_path ?? []).map((s: any) => s.path as string);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-rpfilter-"));
    await cp(join(import.meta.dirname, "..", "fixtures", "docs-vault"), dir, { recursive: true });
    const old = new Date("2020-01-01");
    // every doc but the top hit is old, so under modifiedAfter the only hit left is the top one and any other path member is a non-hit neighbour
    for (const f of await readdir(dir, { recursive: true })) if (f.endsWith(".md") && f !== join("operational", "deploying-edge-agent.md")) await utimes(join(dir, f), old, old);
    const server = await createServer(dir, { watch: false, waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "rpfilter", version: "1.0.0" });
    await client.connect(ct);
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    if (dir) await cleanupTempDir(dir);
  });

  it("builds a path on a doc-only graph, and a date filter keeps non-hit neighbours out of it", async () => {
    expect(existsSync(join(dir, ".hewtd", "graph.json"))).toBe(false);
    expect((await pathOf()).length).toBeGreaterThan(1);
    expect(await pathOf({ modifiedAfter: "2021-01-01" })).toEqual(["operational/deploying-edge-agent.md"]);
  });
});

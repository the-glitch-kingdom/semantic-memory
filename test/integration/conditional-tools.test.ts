import { describe, it, expect, afterAll } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

/**
 * Conditional tool registration (v1.4 Phase 7) — DEFAULT OFF, opt-in via
 * tools.conditional + outage-silence mode → minimal read/search surface.
 */
describe("Conditional tool registration (v1.4)", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await cleanupTempDir(d);
  });

  async function toolCount(schema: string, mode: string): Promise<number> {
    const vault = await createTempVault();
    dirs.push(vault);
    await writeFile(join(vault, "vault.schema.yml"), schema, "utf-8");
    await mkdir(join(vault, ".claude", ".semantic-memory"), { recursive: true });
    await writeFile(join(vault, ".claude", ".semantic-memory", "mode"), mode, "utf-8");
    const server = await createServer(vault, { watch: false, waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "cond-client", version: "1.0.0" });
    await client.connect(ct);
    const { tools } = await client.listTools();
    await client.close();
    return tools.length;
  }

  it("registers the full surface by default (conditional off), even in outage mode", async () => {
    expect(await toolCount("tools:\n  conditional: false\n", "outage-silence")).toBe(45);
  }, 180_000);

  it("registers a reduced surface when conditional on AND mode is outage-silence", async () => {
    const n = await toolCount("tools:\n  conditional: true\n", "outage-silence");
    expect(n).toBeLessThan(45);
    expect(n).toBeGreaterThan(0); // search + read + system remain
  }, 180_000);
});

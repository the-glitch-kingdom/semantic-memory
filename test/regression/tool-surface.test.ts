/**
 * Regression-snapshot baseline for the MCP tool surface.
 *
 * Captures the COMPLETE structure of every tool the server exposes:
 * name, description, and full inputSchema. The snapshot is the gate —
 * any rename, removal, schema change, or description edit will break
 * the test loudly and require an explicit `npm test -- -u` to update.
 *
 * Companion to test/integration/mcp-server.test.ts (which asserts
 * specific behaviors): this file proves *structural* stability across
 * refactors. Captured BEFORE the semantic-memory rebrand so any drift
 * during the rebrand surfaces immediately.
 *
 * If a snapshot fails:
 *   - If the change is intentional (a tool was renamed, a schema was
 *     extended), update the snapshot via `npm test -- -u` and document
 *     the intentional break in the relevant CHANGELOG.
 *   - If the change is unintentional, fix the regression.
 *
 * See docs/regression-snapshot.md for the full process.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { createTempVault, cleanupTempDir } from "../setup.js";

describe("Regression: MCP tool surface (golden snapshots)", () => {
  let client: Client;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempVault();
    const server = await createServer(tempDir, { watch: false, waitForReady: true });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "regression-client", version: "1.0.0" });
    await client.connect(clientTransport);
  }, 180_000);

  afterAll(async () => {
    await client.close();
    await cleanupTempDir(tempDir);
  });

  it("exposes the expected number of tools (write mode = 44)", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(44);
  });

  it("matches the golden tool-surface snapshot", async () => {
    const { tools } = await client.listTools();

    // Sort by name for stable ordering — the SDK's internal map iteration
    // order is implementation-defined, so we normalize before snapshotting.
    const normalized = tools
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

    expect(normalized).toMatchSnapshot();
  });

  it("matches the golden tool-name list (compact)", async () => {
    // A second, narrower snapshot that only captures names. Useful for
    // grep-friendly diffs in PR review when only the surface changed,
    // not the schema details.
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toMatchSnapshot();
  });
});

describe("Regression: MCP tool surface in --read-only mode", () => {
  let client: Client;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await createTempVault();
    const server = await createServer(tempDir, {
      watch: false,
      waitForReady: true,
      readOnly: true,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "regression-readonly-client", version: "1.0.0" });
    await client.connect(clientTransport);
  }, 180_000);

  afterAll(async () => {
    await client.close();
    await cleanupTempDir(tempDir);
  });

  it("suppresses the expected number of write tools (read-only mode = 20)", async () => {
    const { tools } = await client.listTools();
    // Contract tools (regenerate_contract, inspect_contract) are gated behind
    // !readOnly because they write AGENTS.md; log_event too (writes log.md) — read-only count is 20.
    expect(tools.length).toBe(20);
  });

  it("matches the golden tool-name list in read-only mode", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toMatchSnapshot();
  });

  it("never exposes write tools in read-only mode", async () => {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((t) => t.name));
    const writeTools = [
      "create_note",
      "update_note",
      "delete_note",
      "move_note",
      "apply_patch",
      "synthesize_note",
      "ingest_source",
      "install_schema",
      "update_frontmatter",
      "manage_tags",
      "rename_tag",
      "regenerate_index",
      "log_event", // writes log.md into a folder another tool owns
    ];
    for (const tool of writeTools) {
      expect(names.has(tool), `read-only mode should not expose ${tool}`).toBe(false);
    }
  });
});

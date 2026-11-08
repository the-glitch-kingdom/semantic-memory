import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildContext } from "../../src/mcp/context.js";
import { registerSearchTools } from "../../src/mcp/tools/search.js";
import { registerReadTools } from "../../src/mcp/tools/read.js";
import { registryFor } from "../../src/mcp/sources.js";
import { readSelectionLog } from "../../src/core/telemetry.js";
import { cleanupTempDir } from "../setup.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("federation: stale-source note and telemetry labels", () => {
  const dirs: string[] = [];
  let client: Client;
  let primary: string;
  let ctx: Awaited<ReturnType<typeof buildContext>>;

  beforeAll(async () => {
    primary = await mkdtemp(join(tmpdir(), "fed-n-p-"));
    const svc = await mkdtemp(join(tmpdir(), "fed-n-s-"));
    dirs.push(primary, svc);
    await cp(join(FIXTURES, "docs-vault"), primary, { recursive: true });
    await cp(join(FIXTURES, "vault"), svc, { recursive: true });
    await writeFile(join(svc, "vault.schema.yml"), "rerank:\n  enabled: true\n"); // a source's own reranker must not load
    await writeFile(join(primary, "vault.schema.yml"), `federation:\n  sources:\n    - {label: svc, path: ${svc}}\n`); // no hewtd config and related_repos left at its default: federation works without it
    // read-only primary: telemetry goes to its index dir, not the user's session dir
    ctx = await buildContext(primary, { readOnly: true });
    await ctx.fullIndex();
    const server = new McpServer({ name: "fed-notes", version: "1.0.0" });
    registerSearchTools(server, ctx);
    registerReadTools(server, ctx);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "fed-notes", version: "1.0.0" });
    await client.connect(ct);

    const reg = registryFor(ctx);
    for (const end = Date.now() + 120_000; (await reg.open()).ready.length === 0 && Date.now() < end; ) await new Promise((ok) => setTimeout(ok, 300));
  }, 240_000);
  afterAll(async () => {
    await client.close();
    await Promise.all(dirs.map(cleanupTempDir));
  });

  it("names a stale source in a trailing block and _meta.stale, content[0] stays the plain array, and logs source hits as label:path", async () => {
    const [h] = (await registryFor(ctx).open()).ready;
    expect(h.label).toBe("svc");
    expect(h.ctx.reranker).toBeNull();
    h.ctx.isStale = () => true;
    const res: any = await client.callTool({ name: "search_hybrid", arguments: { query: "what is the single entry point for client requests", limit: 8 } });
    h.ctx.isStale = () => false;
    expect(Array.isArray(JSON.parse(res.content[0].text))).toBe(true);
    expect(res.content.at(-1).text).toContain('source "svc" is stale');
    expect(res._meta?.stale).toBe(true);

    await client.callTool({ name: "read_note", arguments: { path: "api-gateway.md", source: "svc" } });
    await client.callTool({ name: "read_note", arguments: { path: "api-gateway.md" } }).catch(() => {});
    const log = await readSelectionLog(primary);
    const searched = log.filter((e: any) => e.kind === "search").flatMap((e: any) => e.results.map((r: any) => r.path));
    expect(searched).toContain("svc:api-gateway.md");
    expect(searched.some((p: string) => !p.includes(":"))).toBe(true); // the primary's own hits stay bare
    expect(log.some((e: any) => e.kind === "selection" && e.note_path === "svc:api-gateway.md")).toBe(true);
  }, 60_000);
});

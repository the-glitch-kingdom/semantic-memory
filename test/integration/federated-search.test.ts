import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("search_hybrid across two sources", () => {
  const dirs: string[] = [];
  let client: Client;
  let svc: string;
  const search = async (query: string, limit = 8) => {
    const res: any = await client.callTool({ name: "search_hybrid", arguments: { query, limit } });
    return { res, hits: JSON.parse(res.content[0].text) as any[] };
  };

  beforeAll(async () => {
    const primary = await mkdtemp(join(tmpdir(), "fed-p-"));
    svc = await mkdtemp(join(tmpdir(), "fed-s-"));
    dirs.push(primary, svc);
    await cp(join(FIXTURES, "docs-vault"), primary, { recursive: true });
    await cp(join(FIXTURES, "vault"), svc, { recursive: true });
    await writeFile(join(primary, "vault.schema.yml"), `federation:\n  related_repos: false\n  sources:\n    - {label: svc, path: ${svc}}\n    - {label: gone, path: ${join(primary, "nope")}}\n`);
    const server = await createServer(primary, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "fed", version: "1.0.0" });
    await client.connect(ct);
  }, 240_000);
  afterAll(async () => {
    await client.close();
    await Promise.all(dirs.map(cleanupTempDir));
  });

  it("reports a source that is still building or missing in a trailing block, then answers from both once ready", async () => {
    const first = await search("how do I rotate API keys");
    expect(Array.isArray(first.hits)).toBe(true);
    expect(first.res.content.at(-1).text).toContain('source "gone" skipped');

    // wait for the background build of svc
    const deadline = Date.now() + 120_000;
    let r = first;
    while (r.hits.some((h) => !h.source) && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 300));
      r = await search("what is the single entry point for client requests");
    }
    expect(r.hits.every((h) => typeof h.source === "string")).toBe(true);
    expect(r.res.content.length).toBe(1); // each skip is reported once
  }, 180_000);

  it("labels results from both sources, finds each side's own answer, and read_note takes the source", async () => {
    const svcHit = (await search("what is the single entry point for client requests")).hits.find((h) => h.source === "svc");
    expect(svcHit?.path).toBe("api-gateway.md");
    expect((await search("What is the default value of TIDEWATCH_FLUSH_MS?")).hits[0]).toMatchObject({ source: "primary" });

    const res: any = await client.callTool({ name: "read_note", arguments: { path: "api-gateway.md", source: "svc" } });
    expect(res.content[0].text).toContain("single entry point");
    const bad: any = await client.callTool({ name: "read_note", arguments: { path: "api-gateway.md", source: "nope" } });
    expect(bad.content[0].text).toContain("Unknown or unavailable source");
  });

  it("keeps each source's own order inside the merged list", async () => {
    const { hits } = await search("how do services communicate and deploy", 10);
    for (const label of ["primary", "svc"]) {
      const scores = hits.filter((h) => h.source === label).map((h) => h.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("never writes into a source", async () => {
    expect((await readdir(svc)).includes(".semantic-sidekick-index")).toBe(false);
    expect((await readFile(join(svc, "orphan.md"), "utf-8")).length).toBeGreaterThan(0);
  });
});

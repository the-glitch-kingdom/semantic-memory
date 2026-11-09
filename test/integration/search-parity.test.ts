import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { openSearch } from "../../src/cli/search.js";
import { cleanupTempDir } from "../setup.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "docs-vault");

describe("docs fixture through the MCP client and the CLI search", () => {
  let dir: string;
  let client: Client;
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return JSON.parse((res.content as { text: string }[])[0].text);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-parity-"));
    await cp(FIXTURE, dir, { recursive: true });
    const server = await createServer(dir, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "parity", version: "1.0.0" });
    await client.connect(ct);
  }, 240_000);
  afterAll(async () => {
    await client.close();
    await cleanupTempDir(dir);
  });

  it("CLI search (the hook path) returns the same order as search_hybrid", async () => {
    const searcher = await openSearch(dir);
    const questions = (await readFile(join(import.meta.dirname, "..", "retrieval-eval", "golden-docs.jsonl"), "utf-8"))
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l).q as string);
    expect(questions.length).toBeGreaterThan(30);
    for (const q of questions) {
      const mcp = (await call("search_hybrid", { query: q, limit: 8 })).map((r: any) => r.path);
      const cli = (await searcher.search(q, 8)).map((r) => r.path);
      expect(cli, q).toEqual(mcp);
    }
  }, 240_000);

  it("CLI search marks its hits stale while a live process holds the index lock", async () => {
    const searcher = await openSearch(dir);
    const lock = join(dir, ".semantic-sidekick-index", "index.lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
    try {
      expect((await searcher.search("how do I rotate API keys", 3)).every((h) => h.stale)).toBe(true);
    } finally {
      await rm(lock);
    }
    expect((await searcher.search("how do I rotate API keys", 3)).some((h) => h.stale)).toBe(false);
  });

  it("every search and graph tool answers with the documented shape", async () => {
    const sem = await call("search_semantic", { query: "how do I rotate API keys", limit: 3 });
    expect(sem[0]).toMatchObject({ path: expect.any(String), confidence: expect.any(Number), snippet: expect.any(String) });
    expect(sem.some((r: any) => r.path.includes("archive/"))).toBe(false);

    const hyb = await call("search_hybrid", { query: "how do I rotate API keys", limit: 3, full: true });
    expect(hyb[0]).toHaveProperty("matchedChunk");

    const text = await call("search_text", { pattern: "flush" });
    expect(text.length).toBeGreaterThan(0);

    const graph = await call("search_graph", { concept: "ingest pipeline", limit: 5 });
    expect(graph.length).toBeGreaterThan(0);
    expect(graph.some((n: any) => n.path.endsWith("INDEX.md"))).toBe(false);

    const start = (await call("forwardlinks", { path: "architecture/ingest-pipeline.md" }))[0];
    expect(start).toBeDefined();
    const back = await call("backlinks", { path: start.path });
    expect(back.map((n: any) => n.path)).toContain("architecture/ingest-pipeline.md");
    const path = await call("graph_path", { from: "architecture/ingest-pipeline.md", to: start.path });
    expect(path).toEqual(["architecture/ingest-pipeline.md", start.path]);

    const stats = await call("get_stats", {});
    expect(stats.indexState).toBe("ready");
  }, 120_000);

  it("a query naming an identifier the docs lack gets the same flag and missing_terms from MCP and the CLI (#57)", async () => {
    const searcher = await openSearch(dir);
    for (const q of ["What does the rotate_harbor_keys job do?", "how do I rotate API keys with fooBarBaz"]) {
      const mcp = await call("search_hybrid", { query: q, limit: 3 });
      const cli = await searcher.search(q, 3);
      expect(mcp.every((r: any) => r.no_strong_match === true && r.missing_terms?.length > 0), q).toBe(true);
      expect(cli.map((r) => r.missing_terms), q).toEqual(mcp.map((r: any) => r.missing_terms));
      expect(cli.every((r) => r.no_strong_match === true), q).toBe(true);
    }
    const sem = await call("search_semantic", { query: "what does rotate_harbor_keys do", limit: 2 });
    expect(sem[0].missing_terms).toEqual(["rotate_harbor_keys"]);
    // plain English with no identifier carries no missing_terms
    expect((await call("search_hybrid", { query: "how do I rotate API keys", limit: 3 })).some((r: any) => r.missing_terms)).toBe(false);
  }, 60_000);

  it("an absent product name is reported without changing the result order (#74)", async () => {
    // an all-caps word is not a name candidate, and both spellings embed and tokenize the same, so only the flag differs
    const named = await call("search_hybrid", { query: "How do I rotate API keys with Hotjar?", limit: 5 });
    const plain = await call("search_hybrid", { query: "How do I rotate API keys with HOTJAR?", limit: 5 });
    expect(named.map((r: any) => r.path)).toEqual(plain.map((r: any) => r.path));
    expect(named[0].missing_terms).toEqual(["Hotjar"]);
    expect(plain.some((r: any) => r.missing_terms)).toBe(false);
  }, 60_000);

  it("an off-topic question is marked no_strong_match on every result", async () => {
    const res = await call("search_hybrid", { query: "recipe for sourdough bread starter", limit: 3 });
    expect(res.every((r: any) => r.no_strong_match === true)).toBe(true);
  }, 60_000);
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";

// #51: `title: 2024` (number) and `title: 2024-05-01` (Date) made search_hybrid throw "s.toLowerCase is not a function".

let dir: string;
let client: Client;

describe("non-string frontmatter titles (#51)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-title-"));
    await writeFile(join(dir, "year.md"), "---\ntitle: 2024\n---\n\nBudget review for the harbor queue.\n");
    await writeFile(join(dir, "date.md"), "---\ntitle: 2024-05-01\n---\n\nRelease notes for the tide gauge.\n");
    await writeFile(join(dir, "list.md"), "---\ntitle: [a, b]\n---\n\nSomething about lighthouse keepers.\n");
    const server = await createServer(dir, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "title-test", version: "1.0.0" });
    await client.connect(ct);
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    await cleanupTempDir(dir);
  });

  it("answers search_hybrid, and the index save keeps string titles", async () => {
    const res = await client.callTool({ name: "search_hybrid", arguments: { query: "harbor queue budget", limit: 3 } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse((res.content as { text: string }[])[0].text).length).toBeGreaterThan(0);
    const titles = Object.fromEntries(JSON.parse(await readFile(join(dir, ".semantic-sidekick-index", "docs.cache.json"), "utf-8")).map((d: any) => [d.path, d.title]));
    expect(titles).toMatchObject({ "year.md": "2024", "date.md": "2024-05-01", "list.md": "a b" });
  });
});

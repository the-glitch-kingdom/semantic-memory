import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const cli = (...a: string[]) => execFileSync("node", ["bin/semantic-memory", ...a], { encoding: "utf8" });
const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map(cleanupTempDir)));

describe("help topics followed step by step in a temp project", () => {
  it("add-index: serve --reindex then serve --stats on a second docs tree", async () => {
    const other = await mkdtemp(join(tmpdir(), "help-idx-"));
    dirs.push(other);
    await cp(join(FIXTURES, "vault"), other, { recursive: true });
    cli("serve", "--notes", other, "--reindex");
    expect(cli("serve", "--stats", "--notes", other)).toMatch(/Notes: [1-9]/);
  }, 120_000);

  it("federated-search: install-schema, uncomment the federation block, search_hybrid carries the label", async () => {
    const primary = await mkdtemp(join(tmpdir(), "help-fed-p-"));
    const svc = await mkdtemp(join(tmpdir(), "help-fed-s-"));
    dirs.push(primary, svc);
    await cp(join(FIXTURES, "docs-vault"), primary, { recursive: true });
    await cp(join(FIXTURES, "vault"), svc, { recursive: true });
    // step 1: the topic's own command writes the commented block
    cli("install-schema", "--notes", primary, "--force");
    const schema = join(primary, "vault.schema.yml");
    const lines = (await readFile(schema, "utf8")).split("\n");
    const i = lines.findIndex((l) => l === "# federation:");
    expect(i).toBeGreaterThan(-1);
    const block = lines.slice(i, i + 6).map((l) => l.replace(/^# ?/, "")).join("\n").replace("../platform/.documentation", svc).replace("platform-docs", "svc");
    await writeFile(schema, `${lines.slice(0, i).join("\n")}\n${block}\n`);
    // steps 3-4: start the server, search, read the source field
    const server = await createServer(primary, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "help-e2e", version: "1.0.0" });
    await client.connect(ct);
    try {
      const deadline = Date.now() + 120_000;
      let hits: any[] = [];
      while (!hits.some((h) => h.source === "svc") && Date.now() < deadline) {
        const r: any = await client.callTool({ name: "search_hybrid", arguments: { query: "what is the single entry point for client requests", limit: 8 } });
        hits = JSON.parse(r.content[0].text);
        if (!hits.some((h) => h.source === "svc")) await new Promise((ok) => setTimeout(ok, 300));
      }
      expect(hits.some((h) => h.source === "svc")).toBe(true);
    } finally {
      await client.close();
    }
  }, 240_000);

  it("the slash command runs the CLI help", () => {
    expect(readFileSync("commands/help.md", "utf8")).toContain("semantic-memory help [topic]");
  });
});

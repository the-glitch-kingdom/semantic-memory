import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { symlink, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { coldChecksum } from "../../src/core/cold.js";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { FAKE_SECRET, GEN_A, makeProject, type Project } from "../long-term-fixture.js";

// #93 Phase 11 edge cases not covered by the acceptance files.

async function connect(dir: string): Promise<Client> {
  const server = await createServer(dir, { waitForReady: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "lt-edge", version: "1.0.0" });
  await client.connect(ct);
  return client;
}
const text = async (c: Client, name: string, args: Record<string, unknown>) => ((await c.callTool({ name, arguments: args })) as any).content.map((x: any) => x.text).join("\n");

describe("sources: [long-term] with no cold generations", () => {
  let p: Project;
  let client: Client;
  beforeAll(async () => { p = await makeProject({ cold: false }); client = await connect(p.docs); }, 240_000);
  afterAll(async () => { await client.close(); await p.cleanup(); });

  it("says so in plain text, never falls back to the default set", async () => {
    const t = await text(client, "search_hybrid", { query: "gateway", sources: ["long-term"] });
    expect(t).toMatch(/no registered generation/);
    expect(() => JSON.parse(t)).toThrow();
  });
});

describe("a live opt-in source, and a locked source that is also default", () => {
  let p: Project;
  let client: Client;
  const FED = "  related_repos: false\n  sources:\n    - {label: live, path: ../legacy-docs, default: false}\n    - {label: both, path: ../legacy-docs2, default: true, locked: true}\n";
  beforeAll(async () => {
    p = await makeProject({ cold: false, federation: FED });
    const { cp } = await import("node:fs/promises");
    await cp(p.legacy, join(p.root, "legacy-docs2"), { recursive: true });
    client = await connect(p.docs);
  }, 240_000);
  afterAll(async () => { await client.close(); await p.cleanup(); });

  /** Ask until the answer holds `want` (a source answers `[]` or "Indexing in progress" while it builds or reconciles). */
  const ask = async (args: Record<string, unknown>, want: string) => {
    let t = "";
    for (let i = 0; i < 400 && !t.includes(want); i++) {
      t = await text(client, "search_text", args);
      if (!t.includes(want)) await new Promise((ok) => setTimeout(ok, 400));
    }
    return t;
  };

  it("an opt-in live source reconciles: a file added after the first build is found", async () => {
    await ask({ pattern: "gateway", sources: ["live"] }, "api-gateway.md");
    await writeFile(join(p.legacy, "added-later.md"), "# Added later\n\nQuokkaword unique marker.\n");
    expect(await ask({ pattern: "Quokkaword", sources: ["live"] }, "added-later.md")).toContain("added-later.md");
  }, 240_000);

  it("a locked default source is searched by default", async () => {
    const t = await text(client, "search_hybrid", { query: "what is the single entry point for client requests" });
    expect(t).toContain('"source"');
    expect(t).toContain("both");
  }, 240_000);
});

describe("read_note on a cold generation", () => {
  let p: Project;
  let client: Client;
  beforeAll(async () => {
    p = await makeProject({ lock: false });
    const gen = join(p.coldRoot, GEN_A);
    await symlink("operational/deploy-credentials.md", join(gen, "alias.md")); // a second name for the flagged file
    await symlink(join(p.root, "outside.md"), join(gen, "out.md"));
    await writeFile(join(p.root, "outside.md"), "outside the generation\n");
    const cfgPath = join(p.root, ".claude", "hit-em-with-the-docs.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.cold_storage.find((c: any) => c.generation === GEN_A).checksum = coldChecksum(gen);
    writeFileSync(cfgPath, JSON.stringify(cfg));
    client = await connect(p.docs);
    for (let i = 0; i < 400 && !(await text(client, "search_text", { pattern: "coalescing", sources: [`cold-${GEN_A}`] })).includes(".md"); i++) await new Promise((ok) => setTimeout(ok, 400));
  }, 240_000);
  afterAll(async () => { await client.close(); await p.cleanup(); });

  it("serves neither a link to a flagged file nor a link out of the tree, and `long-term` is not a folder", async () => {
    const source = `cold-${GEN_A}`;
    expect(await text(client, "read_note", { path: "alias.md", source })).not.toContain(FAKE_SECRET);
    expect(await text(client, "read_note", { path: "out.md", source })).not.toContain("outside the generation");
    expect(await text(client, "read_note", { path: "operational/skerry-cache-stampede.md", source })).toContain("coalescing");
    expect(await text(client, "read_note", { path: "x.md", source: "long-term" })).toMatch(/search target/);
  }, 60_000);
});

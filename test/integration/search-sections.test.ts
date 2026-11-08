import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { openSearch } from "../../src/cli/search.js";
import { extractSection } from "../../src/core/section.js";
import { cleanupTempDir } from "../setup.js";

const FIX = join(import.meta.dirname, "..", "fixtures");
const Q = "How long after cutover can a schema change be undone with the down-migration instead of restoring a snapshot?";

async function open(fixture: string, sub = "") {
  const root = await mkdtemp(join(tmpdir(), "sp-sec-"));
  await cp(join(FIX, fixture), root, { recursive: true });
  const dir = join(root, sub);
  const server = await createServer(dir, { watch: false, waitForReady: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "sec", version: "1.0.0" });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse(((await client.callTool({ name, arguments: args })).content as any)[0].text);
  return { dir, root, client, call };
}

describe("section fields on a long runbook", () => {
  let h: Awaited<ReturnType<typeof open>>;
  beforeAll(async () => { h = await open("section-vault", ".documentation"); }, 240_000);
  afterAll(async () => { await h.client.close(); await cleanupTempDir(h.root); });

  it("search_hybrid and the CLI name the section, its anchor and no trail line in the excerpt", async () => {
    const cli = (await (await openSearch(h.dir)).search(Q, 3))[0];
    for (const tool of ["search_hybrid", "search_semantic"]) {
      const top = (await h.call(tool, { query: Q, limit: 3 }))[0];
      expect(top.path).toBe("operational/platform-runbook.md");
      expect(top.anchor).toBe("database");
      expect(top.section).toMatch(/Rollback > Database$/);
      expect(top.snippet).not.toContain("Rollback > Database\n");
      expect(top.code?.length ?? 0).toBeLessThanOrEqual(3);
      if (tool === "search_hybrid") expect({ section: cli.section, anchor: cli.anchor, code: cli.code }).toEqual({ section: top.section, anchor: top.anchor, code: top.code });
    }
    const full = (await h.call("search_hybrid", { query: Q, limit: 1, full: true }))[0];
    expect(full.anchor).toBe("database");
  });

  it("granularity doc drops the section fields, in MCP and CLI", async () => {
    const top = (await h.call("search_hybrid", { query: Q, limit: 3, granularity: "doc" }))[0];
    expect(top.anchor).toBeUndefined();
    expect(top.section).toBeUndefined();
    expect(top.code).toBeUndefined();
    const cli = (await (await openSearch(h.dir, { granularity: "doc" })).search(Q, 3))[0];
    expect(cli.anchor).toBeUndefined();
  });

  it("read_note section accepts #anchor and returns that section only", async () => {
    const text = await h.client.callTool({ name: "read_note", arguments: { path: "operational/platform-runbook.md", section: "#database" } });
    const body = (text.content as any)[0].text as string;
    expect(body).toMatch(/^#{1,6} Database/);
    const md = await readFile(join(h.dir, "operational/platform-runbook.md"), "utf-8");
    expect(body.length).toBeLessThan(md.length / 5);
    expect(extractSection(md, "#no-such-anchor")).toBeNull();
  });
});

describe("granularity doc is the v1.16.0 output", () => {
  let h: Awaited<ReturnType<typeof open>>;
  beforeAll(async () => { h = await open("flat-vault"); }, 240_000);
  afterAll(async () => { await h.client.close(); await cleanupTempDir(h.root); });

  // Snapshot taken by running main @ 24c88af (v1.16.0) on test/fixtures/flat-vault. Heading-free docs chunk the same
  // before and after sections, so every field and the excerpt must match; only the file mtime and float noise are normalised.
  it("matches a snapshot of v1.16.0's search_hybrid and search_semantic, trimmed and full", async () => {
    const snap = JSON.parse(await readFile(join(FIX, "flat-vault-v1.16.0.json"), "utf-8")) as any[];
    expect(snap.length).toBe(24);
    for (const s of snap) {
      const got = (await h.call(s.tool, { query: s.q, limit: 3, full: s.full, granularity: "doc" })).map((x: any) => ({ ...x, score: Math.round(x.score * 1e4) / 1e4, mtime: undefined }));
      const norm = (rs: any[]) => rs.map((x) => ({ ...x, score: undefined, cosine: undefined }));
      expect(norm(got), `${s.tool} ${s.full} ${s.q}`).toEqual(norm(s.results));
      got.forEach((x: any, i: number) => expect(Math.abs(x.score - s.results[i].score)).toBeLessThan(2e-3));
      // no headings, so the default granularity adds nothing either
      const dflt = await h.call(s.tool, { query: s.q, limit: 3, full: s.full });
      expect(dflt.every((x: any) => x.section === undefined && x.anchor === undefined && x.code === undefined)).toBe(true);
    }
  }, 120_000);
});

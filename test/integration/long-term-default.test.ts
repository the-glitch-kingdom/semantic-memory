import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";
import { FIXTURES, makeProject, sameJson, type Project } from "../long-term-fixture.js";
import { SNAP_QUERIES } from "./single-source-queries.js";

// #93 acceptance, "default output unchanged": an opt-in source (`default: false`) and a cold_storage manifest are
// configured, and every default answer must equal a run with neither.

const CLI = join(import.meta.dirname, "..", "..", "dist", "cli", "index.js");
const strip = (t: string) => JSON.parse(t, (k, v) => (k === "mtime" ? undefined : v)); // the copies' own file times

async function connect(dir: string): Promise<Client> {
  const server = await createServer(dir, { waitForReady: true });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "lt-default", version: "1.0.0" });
  await client.connect(ct);
  return client;
}

describe("default traffic with an opt-in source and a cold_storage manifest configured", () => {
  let p: Project;
  let baseDir: string;
  let configured: Client;
  let baseline: Client;
  const call = async (c: Client, name: string, args: Record<string, unknown>) => {
    const r: any = await c.callTool({ name, arguments: args });
    return r;
  };

  beforeAll(async () => {
    p = await makeProject({ federation: "  related_repos: false\n  sources:\n    - {label: legacy, path: ../legacy-docs, default: false}\n" });
    baseDir = await mkdtemp(join(tmpdir(), "lt-base-"));
    await cp(join(FIXTURES, "docs-vault"), baseDir, { recursive: true });
    [configured, baseline] = await Promise.all([connect(p.docs), connect(baseDir)]);
    await configured.callTool({ name: "search_hybrid", arguments: { query: "gateway" } }); // warm the first answer
  }, 240_000);
  afterAll(async () => {
    await Promise.all([configured.close(), baseline.close()]);
    await Promise.all([p.cleanup(), cleanupTempDir(baseDir)]);
  });

  it("search_hybrid answers exactly as v1.18.0 did (the snapshot): same fields, order, one content block, no source label", async () => {
    const snap = JSON.parse(await readFile(join(FIXTURES, "federation", "single-source-snapshot.json"), "utf-8"));
    expect(snap.length).toBe(SNAP_QUERIES.length);
    for (const { args, content, _meta } of snap) {
      const res = await call(configured, "search_hybrid", args);
      expect(res.content.length, args.query).toBe(1);
      expect(res._meta, args.query).toEqual(_meta);
      const got = strip(res.content[0].text);
      expect(sameJson(got, strip(content[0].text), args.query), args.query).toBeUndefined();
      expect(got.some((r: any) => "source" in r), args.query).toBe(false);
    }
  });

  it("abstention flags and absence of source labels equal a run with nothing configured", async () => {
    for (const query of ["what is the weather on mars", "What does the nonexistent_function_xyz helper return?", "What is the default value of TIDEWATCH_FLUSH_MS?"]) {
      const a = await call(configured, "search_hybrid", { query, limit: 5 });
      const b = await call(baseline, "search_hybrid", { query, limit: 5 });
      const flags = (r: any) => JSON.parse(r.content[0].text).map((h: any) => [h.path, h.no_strong_match, h.missing_terms, h.passing_terms, h.undocumented, "source" in h]);
      expect(flags(a), query).toEqual(flags(b));
    }
  });

  // search_semantic, search_text and read_note do not federate today, so these hold now and stay as regression guards
  it("search_semantic, search_text and read_note without `source` equal a run with nothing configured", async () => {
    for (const [name, args] of [
      ["search_semantic", { query: "How do I roll back a faulty release?", limit: 5 }],
      ["search_text", { query: "TIDEWATCH_FLUSH_MS", limit: 5 }],
      ["read_note", { path: "architecture/ingest-pipeline.md" }],
    ] as const) {
      const a = await call(configured, name, args);
      const b = await call(baseline, name, args);
      expect(sameJson(strip(JSON.stringify(a.content)), strip(JSON.stringify(b.content)), name), name).toBeUndefined();
    }
  });

  it("never builds or loads the opt-in source's index on default traffic: nothing under <primary index>/sources/", async () => {
    await call(configured, "search_hybrid", { query: "what is the single entry point for client requests" });
    await call(configured, "search_text", { query: "gateway" });
    expect(existsSync(join(p.index, "sources"))).toBe(false);
  });

  // the CLI has no federation today, so its default output already ignores the configuration
  it("CLI `search` without --source prints what it prints with nothing configured", () => {
    for (const q of ["What is the default value of TIDEWATCH_FLUSH_MS?", "what is the weather on mars"]) {
      const run = (notes: string) => spawnSync("node", [CLI, "search", q, "--notes", notes, "--limit", "5"], { encoding: "utf8", timeout: 120_000 });
      const a = run(p.docs);
      const b = run(baseDir);
      expect(a.status, a.stderr).toBe(0);
      expect(sameJson(strip(a.stdout), strip(b.stdout), q), q).toBeUndefined();
    }
  }, 240_000);
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp/server.js";
import { cleanupTempDir } from "../setup.js";
import { SNAP_QUERIES } from "./single-source-queries.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

/** Numbers within 1e-4 (batched ONNX output is not bit-exact across CPUs), everything else exactly equal. */
function expectSame(got: unknown, want: unknown, at: string): void {
  if (typeof want === "number" && typeof got === "number") return void expect(Math.abs(got - want), at).toBeLessThan(1e-4);
  if (Array.isArray(want) || (want && typeof want === "object")) {
    expect(Object.keys(got as object), at).toEqual(Object.keys(want as object));
    for (const k of Object.keys(want as object)) expectSame((got as any)[k], (want as any)[k], `${at}.${k}`);
    return;
  }
  expect(got, at).toBe(want);
}

describe("search_hybrid with no federation configured", () => {
  let dir: string;
  let client: Client;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sp-snap-"));
    await cp(join(FIXTURES, "docs-vault"), dir, { recursive: true });
    const server = await createServer(dir, { waitForReady: true });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client({ name: "snap", version: "1.0.0" });
    await client.connect(ct);
  }, 240_000);
  afterAll(async () => {
    await client.close();
    await cleanupTempDir(dir);
  });

  // single-source-snapshot.json was taken from the v1.18.0 pipeline, before hybridRanked was extracted
  it("answers exactly as v1.18.0 did: same fields, order, one content block, no source label", async () => {
    const snap = JSON.parse(await readFile(join(FIXTURES, "federation", "single-source-snapshot.json"), "utf-8"));
    expect(snap.length).toBe(SNAP_QUERIES.length);
    for (const { args, content, _meta } of snap) {
      const res: any = await client.callTool({ name: "search_hybrid", arguments: args });
      expect(res.content.length, args.query).toBe(1);
      expect(res._meta, args.query).toEqual(_meta);
      const strip = (t: string) => JSON.parse(t, (k, v) => (k === "mtime" ? undefined : v)); // the copy's own file times
      const want = strip(content[0].text);
      const got = strip(res.content[0].text);
      expectSame(got, want, args.query);
      expect(got.some((r: any) => "source" in r), args.query).toBe(false);
    }
  });
});

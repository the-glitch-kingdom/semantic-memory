import { cp, mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { glob } from "glob";
import { createServer } from "../../src/mcp/server.js";
import { armsOf } from "../../src/core/retrieval-eval/runner.js";

/** An in-process server over a temp copy of `source` (index dirs left behind), plus the arms and doc texts the facet eval needs. `vault` is the notes folder inside `source` (a repo whose docs sit in `.documentation`); the copy keeps the rest of the repo around it. */
export async function startEval(source: string, prefix: string, prepare?: (dir: string) => Promise<void>, vault = "") {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await cp(source, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
  await prepare?.(dir);
  const server = await createServer(join(dir, vault), { watch: false, waitForReady: true, model: process.env.EVAL_MODEL });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: prefix, version: "1.0.0" });
  await client.connect(ct);

  const { call, tool } = armsOf(client);
  const texts = new Map<string, string>();
  for (const p of await glob("**/*.md", { cwd: join(source, vault) })) texts.set(p, readFileSync(join(source, vault, p), "utf-8"));
  return { dir, client, call, tool, textOf: (p: string) => texts.get(p) ?? "" };
}

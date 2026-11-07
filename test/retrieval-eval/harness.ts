import { cp, mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { glob } from "glob";
import { createServer } from "../../src/mcp/server.js";
import type { ArmFn } from "./eval.js";

/** An in-process server over a temp copy of `source` (index dirs left behind), plus the arms and doc texts the facet eval needs. */
export async function startEval(source: string, prefix: string, prepare?: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await cp(source, dir, { recursive: true, filter: (s) => !s.includes(".semantic-sidekick-index") });
  await prepare?.(dir);
  const server = await createServer(dir, { watch: false, waitForReady: true, model: process.env.EVAL_MODEL });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: prefix, version: "1.0.0" });
  await client.connect(ct);

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as any)[0].text as string;
    let parsed: any = [];
    try { parsed = JSON.parse(text); } catch { /* indexing message */ }
    return { parsed: Array.isArray(parsed) ? parsed : [], bytes: Buffer.byteLength(text) };
  };
  const tool = (name: string, extra: Record<string, unknown> = {}): ArmFn => async (q, limit) => {
    const { parsed, bytes } = await call(name, { query: q, limit, ...extra });
    return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes, weak: parsed.some((r: any) => r.no_strong_match), related: (parsed[0]?.related ?? []).map((r: any) => r.path), decay: Object.fromEntries(parsed.filter((r: any) => r.decay).map((r: any) => [r.path, { multiplier: r.decay.multiplier, source: r.decay.source }])) };
  };
  const texts = new Map<string, string>();
  for (const p of await glob("**/*.md", { cwd: source })) texts.set(p, readFileSync(join(source, p), "utf-8"));
  return { dir, client, call, tool, textOf: (p: string) => texts.get(p) ?? "" };
}

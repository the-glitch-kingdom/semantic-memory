import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../mcp/server.js";
import { readMeta } from "../index-store.js";
import type { ArmFn } from "./metrics.js";

/** Runs a search tool through an MCP client and shapes the reply into what the facet eval scores. */
export function armsOf(client: Client) {
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as any)[0].text as string;
    let parsed: any = [];
    try { parsed = JSON.parse(text); } catch { /* indexing message */ }
    return { parsed: Array.isArray(parsed) ? parsed : [], bytes: Buffer.byteLength(text) };
  };
  const tool = (name: string, extra: Record<string, unknown> = {}): ArmFn => async (q, limit) => {
    const { parsed, bytes } = await call(name, { query: q, limit, ...extra });
    return { results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes, weak: parsed.some((r: any) => r.no_strong_match), related: (parsed[0]?.related ?? []).map((r: any) => r.path), readingPath: (parsed[0]?.reading_path ?? []).map((r: any) => r.path), decay: Object.fromEntries(parsed.filter((r: any) => r.decay).map((r: any) => [r.path, { multiplier: r.decay.multiplier, source: r.decay.source }])) };
  };
  return { call, tool };
}

/**
 * The live search path over the user's existing index, with no side effects: it refuses when there is no index,
 * opens it with the model, pooling and prompt its meta.json recorded (any other setting would re-embed it), and
 * logs no searches.
 */
export async function openEval(notes: string) {
  const meta = await readMeta(join(notes, ".semantic-sidekick-index"));
  if (!meta) throw new Error(`No index under ${notes}: run semantic-memory --reindex first.`);
  const server = await createServer(notes, {
    watch: false, waitForReady: true, readOnly: true, telemetry: false,
    model: meta.model, pooling: meta.pooling === "cls" ? "cls" : "mean", queryPrompt: meta.queryPrompt ?? "",
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "retrieval-eval", version: "1.0.0" });
  await client.connect(ct);
  return { client, ...armsOf(client), close: () => client.close() };
}

import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "../../mcp/server.js";
import { readMeta } from "../index-store.js";
import type { ArmFn } from "./metrics.js";

/** Runs a search tool through an MCP client and shapes the reply into what the facet eval scores. */
export function armsOf(client: Client, patient?: { onAnswer: () => void }) {
  const call = async (name: string, args: Record<string, unknown>) => {
    // a stdio server answers "Indexing in progress" until its vector index exists: wait for the first real answer, never score the message
    for (const deadline = Date.now() + 300_000; ; await new Promise((r) => setTimeout(r, 250))) {
      const res = await client.callTool({ name, arguments: args });
      const text = (res.content as any)[0].text as string;
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* indexing message */ }
      if (Array.isArray(parsed)) { patient?.onAnswer(); return { parsed, bytes: Buffer.byteLength(text) }; }
      if (!patient || !text.startsWith("Indexing") || Date.now() > deadline) return { parsed: [], bytes: Buffer.byteLength(text) };
    }
  };
  const tool = (name: string, extra: Record<string, unknown> = {}): ArmFn => async (q, limit) => {
    const { parsed, bytes } = await call(name, { query: q, limit, ...extra });
    return { top: parsed[0], results: parsed.map((r: any) => ({ path: r.path, score: r.score })), bytes, weak: parsed.some((r: any) => r.no_strong_match), related: (parsed[0]?.related ?? []).map((r: any) => r.path), readingPath: (parsed[0]?.reading_path ?? []).map((r: any) => r.path), decay: Object.fromEntries(parsed.filter((r: any) => r.decay).map((r: any) => [r.path, { multiplier: r.decay.multiplier, source: r.decay.source }])) };
  };
  return { call, tool };
}

export interface EvalVia {
  /** Spawn the stdio server as the plugin launches it (`--notes <notes> --read-only`, cwd = the repo) instead of the in-process one. */
  cli: string;
  cwd: string;
  /** Block the server's startup until it is ready (the plugin does not): off by default, so the first query lands in the load window. */
  waitForReady?: boolean;
}

/**
 * The live search path over the user's existing index, with no side effects: it refuses when there is no index,
 * opens it with the model, pooling and prompt its meta.json recorded (any other setting would re-embed it), and
 * logs no searches. With `via`, the same client talks to the stdio server instead, so the eval sees what an agent sees.
 */
export async function openEval(notes: string, via?: EvalVia) {
  const meta = await readMeta(join(notes, ".semantic-sidekick-index"));
  if (!meta) throw new Error(`No index under ${notes}: run semantic-memory --reindex first.`);
  const t0 = Date.now();
  const timing: { firstAnswerMs?: number } = {};
  const client = new Client({ name: "retrieval-eval", version: "1.0.0" });
  if (via) {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [via.cli, "--notes", notes, "--read-only", ...(via.waitForReady ? ["--wait-for-ready"] : [])], cwd: via.cwd, stderr: "ignore" }));
  } else {
    const server = await createServer(notes, {
      watch: false, waitForReady: true, readOnly: true, telemetry: false,
      model: meta.model, pooling: meta.pooling === "cls" ? "cls" : "mean", queryPrompt: meta.queryPrompt ?? "",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
  }
  return { client, timing, ...armsOf(client, via && { onAnswer: () => { timing.firstAnswerMs ??= Date.now() - t0; } }), close: () => client.close() };
}

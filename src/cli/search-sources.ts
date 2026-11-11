import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolve } from "node:path";
import { loadFederation } from "../core/federation.js";
import { createServer } from "../mcp/server.js";

/**
 * `search --source`: the MCP search_hybrid tool run in-process, so the CLI and the tool share one resolver
 * (labels, long-term, locked sources, checksum, secrets). Opt-in indexes go under the primary's sources/ dir, never into a source folder.
 * Hits are the tool's (they carry `source` and `historical`), not the plain CLI shape.
 */
export async function runSourceSearch(o: { notes: string; query: string; limit: number; sources: string[]; reindex?: boolean }): Promise<unknown[]> {
  const notes = resolve(o.notes);
  // the primary is built only when it is asked for; a sources-only search never touches its index
  const server = await createServer(notes, { readOnly: true, telemetry: false, skipStartIndex: !o.sources.includes("primary") });
  const client = new Client({ name: "semantic-memory-cli", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return { text: r.content[0].text, notes: r.content.slice(1).map((c) => c.text) };
  };
  const search = async () => {
    // the CLI is synchronous: a source or the primary still building is waited for (up to 10 min)
    for (let i = 0; i < 600; i++) {
      const r = await call("search_hybrid", { query: o.query, limit: o.limit, sources: o.sources });
      const wait = /^Indexing in progress/.test(r.text) || r.notes.some((n) => /still indexing/.test(n));
      if (!wait) {
        for (const n of r.notes) process.stderr.write(`${n}\n`);
        let hits: unknown;
        try { hits = JSON.parse(r.text); } catch { /* a plain-text refusal */ }
        if (!Array.isArray(hits)) throw new Error(r.text);
        return hits;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error("timed out waiting for the index to build");
  };
  try {
    let hits = await search();
    if (o.reindex) {
      const fed = loadFederation(notes).sources;
      const labels = o.sources.flatMap((l) => (l === "long-term" ? fed.filter((s) => s.historical).map((s) => s.label) : [l]));
      for (const source of labels) process.stderr.write(`${(await call("reindex", { source })).text}\n`);
      hits = await search();
    }
    return hits;
  } finally {
    await client.close();
    await server.close();
  }
}

#!/usr/bin/env node
// Freshness audit of a built index: re-embed a sample of current chunks and compare them with the stored vectors.
//
//   node scripts/retrieval-eval/stale-audit.mjs <notes-dir> [--sample 200]
//
// Needs `npm run build` and an existing <notes-dir>/.semantic-sidekick-index. Read-only. Prints JSON:
//   staleShare  share of sampled chunks whose stored vector has cosine < 0.99 to a fresh embedding of the chunk text
//   missing     current chunks with no stored vector
//   orphans     stored vectors no current chunk references
//   coldStartMs createServer() to first search answer with the cache as found on disk
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Embedder, Indexer } from "../../dist/core/index.js";
import { createServer } from "../../dist/mcp/server.js";

const notes = resolve(process.argv[2] ?? "");
const si = process.argv.indexOf("--sample");
const sample = si >= 0 ? Number(process.argv[si + 1]) : 200;
const indexPath = join(notes, ".semantic-sidekick-index");
if (!process.argv[2] || !existsSync(join(indexPath, "embeddings.json"))) {
  console.error("usage: stale-audit.mjs <notes-dir> [--sample N]  (index must exist)");
  process.exit(2);
}

// start the server first: the audit judges the index a session would actually search after startup
const t0 = performance.now();
const server = await createServer(notes, { watch: false, waitForReady: true });
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: "stale-audit", version: "1.0.0" });
await client.connect(ct);
await client.callTool({ name: "search_semantic", arguments: { query: "audit", limit: 1 } });
const coldStartMs = Math.round(performance.now() - t0);
await client.close();

const stored = new Map(JSON.parse(readFileSync(join(indexPath, "embeddings.json"), "utf8")).map((e) => [e.key, Float32Array.from(e.data)]));
// current chunks come from the files on disk, not docs.cache.json, which can be as stale as the vectors
const docs = await new Indexer(notes).indexAll();

// Keys are positional (`path:i`) until Phase 3 hashes them, so the audit reads whatever key shape matches the chunk list.
const chunks = docs.flatMap((d) => d.chunks.map((text, i) => ({ key: `${d.path}:${i}`, text })));
const live = new Set(chunks.map((c) => c.key));
const missing = chunks.filter((c) => !stored.has(c.key)).length;
const orphans = [...stored.keys()].filter((k) => !live.has(k)).length;

const cos = (a, b) => {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return d / Math.sqrt(x * y);
};
const step = Math.max(1, Math.floor(chunks.length / sample)); // even spread, deterministic
const picked = chunks.filter((c, i) => i % step === 0 && stored.has(c.key));
const embedder = new Embedder();
await embedder.init();
let stale = 0;
for (const c of picked) if (cos(stored.get(c.key), await embedder.embed(c.text)) < 0.99) stale++;

console.log(JSON.stringify({ chunks: chunks.length, sampled: picked.length, staleShare: picked.length ? stale / picked.length : 0, missing, orphans, coldStartMs }, null, 2));
process.exit(0);

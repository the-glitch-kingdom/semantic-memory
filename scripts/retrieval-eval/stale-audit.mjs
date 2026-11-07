#!/usr/bin/env node
// Freshness audit of a built index: re-embed a sample of current chunks and compare them with the stored vectors.
//
//   node scripts/retrieval-eval/stale-audit.mjs <notes-dir> [--sample 200]
//
// Needs `npm run build` and an existing <notes-dir>/.semantic-sidekick-index. Read-only. Prints JSON:
//   staleShare  share of sampled chunks whose stored vector has cosine < 0.99 to a fresh embedding of the chunk text
//   missing     current chunks with no stored vector
//   orphans     stored vectors no current chunk references
//   indexMismatch  chunks in the committed HNSW metadata that differ from the files on disk (either direction)
//   hnswRecall  mean recall@24 of VectorIndex.search against exact cosine over the stored vectors, for the eval questions (gate >= 0.97)
//   coldStartMs createServer() to first search answer with the cache as found on disk
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Embedder, Indexer, VectorIndex } from "../../dist/core/index.js";
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
const server = await createServer(notes, { waitForReady: true });
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: "stale-audit", version: "1.0.0" });
await client.connect(ct);
await client.callTool({ name: "search_semantic", arguments: { query: "audit", limit: 1 } });
const coldStartMs = Math.round(performance.now() - t0);
await client.close();
await new Promise((r) => setTimeout(r, 2500)); // the reconcile saves on a 2 s debounce

const stored = new Map(JSON.parse(readFileSync(join(indexPath, "embeddings.json"), "utf8")).map((e) => [e.key, Float32Array.from(e.data)]));
// current chunks come from the files on disk, not docs.cache.json, which can be as stale as the vectors
const docs = await new Indexer(notes).indexAll();

const model = JSON.parse(readFileSync(join(indexPath, "meta.json"), "utf8")).model;
const keyOf = (text) => createHash("sha256").update(`${model}\0${text}`).digest("hex");
const chunks = docs.flatMap((d) => d.chunks.map((text) => ({ key: keyOf(text), path: d.path, text })));
const live = new Set(chunks.map((c) => c.key));
const missing = chunks.filter((c) => !stored.has(c.key)).length;
const orphans = [...stored.keys()].filter((k) => !live.has(k)).length;

const hnsw = JSON.parse(readFileSync(join(indexPath, "hnsw-meta.json"), "utf8")).filter(Boolean);
const onDisk = new Set(chunks.map((c) => `${c.path}\0${c.text}`));
const inIndex = new Set(hnsw.map((m) => `${m.docPath}\0${m.text}`));
const indexMismatch = [...onDisk].filter((k) => !inIndex.has(k)).length + [...inIndex].filter((k) => !onDisk.has(k)).length;

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

// HNSW recall: a fresh index over the stored vectors vs brute-force cosine, docs of the top-24 chunks (best chunk per doc, as search dedups)
const withVec = chunks.filter((c) => stored.has(c.key));
const hnswIndex = new VectorIndex(stored.get(withVec[0].key).length);
hnswIndex.build(withVec.map((c) => stored.get(c.key)), withVec.map((c, i) => ({ docPath: c.path, chunkIndex: i, text: c.text })));
const questions = ["real-corpus.jsonl", "real-corpus-heldout.jsonl"].flatMap((f) =>
  readFileSync(new URL(`../../test/retrieval-eval/${f}`, import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l).q));
let recallSum = 0;
for (const q of questions) {
  const qv = await embedder.embedQuery(q);
  const exact = new Set(withVec.map((c) => ({ p: c.path, s: cos(qv, stored.get(c.key)) })).sort((a, b) => b.s - a.s).slice(0, 24).map((e) => e.p));
  recallSum += hnswIndex.search(qv, 24).filter((r) => exact.has(r.path)).length / exact.size;
}

console.log(JSON.stringify({ chunks: chunks.length, sampled: picked.length, staleShare: picked.length ? stale / picked.length : 0, missing, orphans, indexMismatch, hnswRecall: Number((recallSum / questions.length).toFixed(3)), coldStartMs }, null, 2));
process.exit(0);

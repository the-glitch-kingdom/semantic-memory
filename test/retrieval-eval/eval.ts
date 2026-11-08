export * from "../../src/core/retrieval-eval/metrics.js";

/**
 * Recall of the HNSW index against exact cosine over the same chunks: for each query, the docs of the exact top-k chunks
 * (best chunk per doc, as VectorIndex.search dedups) against the docs `VectorIndex.search` returns. Mean over queries.
 */
export async function hnswRecall(notesDir: string, queries: string[], k: number): Promise<number> {
  const { Indexer, Embedder, VectorIndex } = await import("../../src/core/index.js");
  const docs = await new Indexer(notesDir).indexAll();
  const chunks = docs.flatMap((d) => d.chunks.map((text, chunkIndex) => ({ docPath: d.path, chunkIndex, text })));
  const embedder = new Embedder();
  await embedder.init();
  const vecs = await embedder.embedBatch(chunks.map((c) => c.text));
  const index = new VectorIndex(vecs[0].length);
  index.build(vecs, chunks);
  const cos = (a: Float32Array, b: Float32Array) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
  let sum = 0;
  for (const q of queries) {
    const qv = await embedder.embedQuery(q);
    const exact = new Set(vecs.map((v, i) => ({ doc: chunks[i].docPath, s: cos(qv, v) })).sort((a, b) => b.s - a.s).slice(0, k).map((e) => e.doc));
    const got = index.search(qv, k).map((r) => r.path);
    sum += got.filter((p) => exact.has(p)).length / exact.size;
  }
  return sum / queries.length;
}

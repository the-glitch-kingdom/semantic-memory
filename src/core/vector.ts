import hnswlib from "hnswlib-node";
const { HierarchicalNSW } = hnswlib;
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { SearchResult } from "./types.js";

const EF_SEARCH = 100;
/** At or below this many live chunks search is exact (brute-force cosine): HNSW is approximate, so two builds of the same files could rank differently (#85). */
export const EXACT_MAX_VECTORS = 100_000;

export interface ChunkMeta {
  docPath: string;
  chunkIndex: number;
  text: string;
  /** metadata chunk (purpose, symptom phrase, or the doc summary `field: "doc"`, which never shows as `matched`); absent on body chunks and on indexes from before it existed */
  kind?: "meta";
  field?: string;
}

/** Every chunk a doc contributes to the vector index: body chunks, then its metadata chunks. */
export const docChunks = (d: { path: string; chunks: string[]; meta?: { field: string; text: string }[] }): ChunkMeta[] => [
  ...d.chunks.map((text, chunkIndex) => ({ docPath: d.path, chunkIndex, text })),
  ...(d.meta ?? []).map((m, i) => ({ docPath: d.path, chunkIndex: d.chunks.length + i, text: m.text, kind: "meta" as const, field: m.field })),
];

const cosineOf = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const unitOf = (v: ArrayLike<number>): Float32Array => {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  const s = n ? 1 / Math.sqrt(n) : 0;
  return Float32Array.from(v, (x) => x * s);
};

export class VectorIndex {
  private index: InstanceType<typeof HierarchicalNSW> | null = null;
  private dimensions: number;
  // by HNSW label; null = deleted. Labels only grow, so compaction is a rebuild (see deletedRatio)
  private chunkMeta: (ChunkMeta | null)[] = [];
  private labelsByDoc = new Map<string, number[]>();
  private live = 0;
  // unit-length copy by label (null = deleted), what exact search scores; same indexing as chunkMeta
  private unit: (Float32Array | null)[] = [];

  constructor(dimensions: number, private metaWeight = 1, private exactMax = EXACT_MAX_VECTORS) {
    this.dimensions = dimensions;
  }

  build(
    embeddings: Float32Array[],
    meta: ChunkMeta[]
  ): void {
    this.index = null;
    this.chunkMeta = [];
    this.unit = [];
    this.labelsByDoc.clear();
    this.live = 0;
    this.addChunks(embeddings, meta);
  }

  /** Add chunks without touching the rest of the index (grows the HNSW capacity as needed). */
  addChunks(embeddings: Float32Array[], meta: ChunkMeta[]): void {
    if (embeddings.length === 0) return;
    if (!this.index) {
      this.index = new HierarchicalNSW("cosine", this.dimensions);
      this.index.initIndex(Math.max(embeddings.length, 16));
    }
    const needed = this.chunkMeta.length + embeddings.length;
    if (needed > this.index.getMaxElements()) this.index.resizeIndex(Math.ceil(needed * 1.5));

    for (let i = 0; i < embeddings.length; i++) {
      const label = this.chunkMeta.length;
      this.index.addPoint(Array.from(embeddings[i]), label);
      this.chunkMeta.push(meta[i]);
      this.unit.push(unitOf(embeddings[i]));
      const labels = this.labelsByDoc.get(meta[i].docPath);
      if (labels) labels.push(label);
      else this.labelsByDoc.set(meta[i].docPath, [label]);
      this.live++;
    }
  }

  /** Mark every chunk of a document deleted (HNSW markDelete: the node stays, searches skip it). */
  removeDoc(docPath: string): void {
    const labels = this.labelsByDoc.get(docPath);
    if (!labels || !this.index) return;
    for (const label of labels) {
      this.index.markDelete(label);
      this.chunkMeta[label] = null;
      this.unit[label] = null;
      this.live--;
    }
    this.labelsByDoc.delete(docPath);
  }

  /** Share of HNSW nodes that are deleted; the caller rebuilds when it grows large. */
  deletedRatio(): number {
    return this.chunkMeta.length === 0 ? 0 : 1 - this.live / this.chunkMeta.length;
  }

  search(queryEmbedding: Float32Array, k: number = 10): SearchResult[] {
    if (!this.index || this.live === 0) return [];

    const numResults = Math.min(k, this.live);
    // nearest first
    const near: { label: number; cos: number }[] = [];
    if (this.live <= this.exactMax && this.unit.length === this.chunkMeta.length) {
      const q = unitOf(queryEmbedding);
      this.unit.forEach((u, label) => {
        if (!u) return;
        let dot = 0;
        for (let i = 0; i < u.length; i++) dot += u[i] * q[i];
        near.push({ label, cos: dot });
      });
      // ties by path, then label, so the order is total
      near.sort((a, b) => b.cos - a.cos || this.chunkMeta[a.label]!.docPath.localeCompare(this.chunkMeta[b.label]!.docPath) || a.label - b.label);
    } else {
      // hnswlib searches at ef=10 unless told otherwise (recall 0.93 on real vectors); set per search so a loaded, grown or rebuilt index all get it
      this.index.setEf(Math.max(EF_SEARCH, numResults));
      const result = this.index.searchKnn(Array.from(queryEmbedding), numResults);
      result.neighbors.forEach((label, i) => near.push({ label, cos: 1 - result.distances[i] }));
    }

    // per doc: the best body chunk and the best metadata chunk
    const docs = new Map<string, { body?: { cos: number; m: ChunkMeta }; meta?: { cos: number; m: ChunkMeta } }>();
    for (const { label, cos } of near) {
      const m = this.chunkMeta[label];
      if (!m) continue;
      const slot = docs.get(m.docPath) ?? {};
      const kind = m.kind === "meta" ? "meta" : "body";
      slot[kind] ??= { cos, m };
      docs.set(m.docPath, slot);
    }

    const results: SearchResult[] = [];
    for (const [path, { body: found, meta }] of docs) {
      const weighted = meta ? this.metaWeight * meta.cos : -Infinity;
      let body = found;
      // the excerpt always comes from the body: when a metadata chunk wins and no body chunk was a near neighbour, find the doc's best one
      if (meta && weighted > (body?.cos ?? -Infinity) && !body) {
        for (const label of this.labelsByDoc.get(path) ?? []) {
          const m = this.chunkMeta[label];
          if (!m || m.kind === "meta") continue;
          const cos = cosineOf(this.index.getPoint(label), queryEmbedding);
          if (!body || cos > body.cos) body = { cos, m };
        }
      }
      const win = weighted > (found?.cos ?? -Infinity);
      const score = win ? weighted : found!.cos;
      const text = (body ?? meta!).m.text;
      results.push({
        path,
        title: path,
        score,
        cosine: score,
        snippet: text.slice(0, 200),
        matchedChunk: text,
        ...(win && meta!.m.field !== "doc" && { matched: { field: meta!.m.field ?? "meta", text: meta!.m.text } }),
      });
    }
    results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    return results.slice(0, numResults);
  }

  /** The doc's body chunk nearest the query vector, read from the stored embeddings (no re-embedding, no search). */
  bestChunk(docPath: string, queryEmbedding: Float32Array): string | undefined {
    let best: { cos: number; text: string } | undefined;
    for (const label of this.labelsByDoc.get(docPath) ?? []) {
      const m = this.chunkMeta[label];
      if (!m || m.kind === "meta" || !this.index) continue;
      const cos = cosineOf(this.index.getPoint(label), queryEmbedding);
      if (!best || cos > best.cos) best = { cos, text: m.text };
    }
    return best?.text;
  }

  async save(indexPath: string): Promise<void> {
    if (!this.index) return;

    this.index.writeIndexSync(join(indexPath, "hnsw.bin"));
    await writeFile(
      join(indexPath, "hnsw-meta.json"),
      JSON.stringify(this.chunkMeta)
    );
  }

  async load(indexPath: string): Promise<boolean> {
    const hnswPath = join(indexPath, "hnsw.bin");
    const metaPath = join(indexPath, "hnsw-meta.json");

    if (!existsSync(hnswPath) || !existsSync(metaPath)) return false;

    const raw = await readFile(metaPath, "utf-8");
    this.chunkMeta = JSON.parse(raw);

    this.index = new HierarchicalNSW("cosine", this.dimensions);
    this.index.initIndex(Math.max(this.chunkMeta.length, 1));
    this.index.readIndexSync(hnswPath);

    this.labelsByDoc.clear();
    this.live = 0;
    // exact search needs the vectors; past the threshold HNSW answers and they are not kept
    this.unit = [];
    const keep = this.chunkMeta.length <= this.exactMax;
    this.chunkMeta.forEach((m, label) => {
      if (keep) this.unit.push(m ? unitOf(this.index!.getPoint(label)) : null);
      if (!m) return;
      this.live++;
      const labels = this.labelsByDoc.get(m.docPath);
      if (labels) labels.push(label);
      else this.labelsByDoc.set(m.docPath, [label]);
    });

    return true;
  }

  /** Live chunks only. */
  getChunkMeta(): ChunkMeta[] {
    return this.chunkMeta.filter((m): m is ChunkMeta => m !== null);
  }
}

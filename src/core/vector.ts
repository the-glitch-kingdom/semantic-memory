import hnswlib from "hnswlib-node";
const { HierarchicalNSW } = hnswlib;
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { SearchResult } from "./types.js";

interface ChunkMeta {
  docPath: string;
  chunkIndex: number;
  text: string;
}

export class VectorIndex {
  private index: InstanceType<typeof HierarchicalNSW> | null = null;
  private dimensions: number;
  // by HNSW label; null = deleted. Labels only grow, so compaction is a rebuild (see deletedRatio)
  private chunkMeta: (ChunkMeta | null)[] = [];
  private labelsByDoc = new Map<string, number[]>();
  private live = 0;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  build(
    embeddings: Float32Array[],
    meta: ChunkMeta[]
  ): void {
    this.index = null;
    this.chunkMeta = [];
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
    const result = this.index.searchKnn(Array.from(queryEmbedding), numResults);

    const seen = new Set<string>();
    const results: SearchResult[] = [];

    for (let i = 0; i < result.neighbors.length; i++) {
      const idx = result.neighbors[i];
      const meta = this.chunkMeta[idx];
      if (!meta || seen.has(meta.docPath)) continue;
      seen.add(meta.docPath);

      results.push({
        path: meta.docPath,
        title: meta.docPath,
        score: 1 - result.distances[i],
        cosine: 1 - result.distances[i],
        snippet: meta.text.slice(0, 200),
        matchedChunk: meta.text,
      });
    }

    return results;
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
    this.chunkMeta.forEach((m, label) => {
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

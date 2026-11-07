import type { SearchResult } from "./types.js";

const K1 = 1.2;
const B = 0.75;

const STOP = new Set(
  "a an the and or but of to in on at by for with from as is are was were be been it its this that these those do does did how what which when where who why can could should would will we our you your i my not no if then than so there their they them has have had into about after before over under".split(" ")
);

export const tokenize = (s: string): string[] =>
  s.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];

interface Chunk {
  docPath: string;
  text: string;
  tf: Map<string, number>;
  len: number;
}

/**
 * In-memory BM25 over chunks (no dependency). Updated per document, so reconcile never rebuilds it.
 * Scoring walks every chunk that shares a term with the query: fine for a docs vault (thousands of
 * chunks); shortcut: no inverted index, add one if a vault passes ~50k chunks.
 */
/** Doc-level text every chunk is also indexed under: a symptom-style query often matches the title or file name, not the chunk. */
export const bm25Fields = (d: { path: string; title?: string; purpose?: string }): string =>
  `${d.title ?? ""} ${d.purpose ?? ""} ${d.path.replace(/[/.\-_]+/g, " ")}`;

export class Bm25Index {
  private byDoc = new Map<string, Chunk[]>();
  private df = new Map<string, number>();
  private chunkCount = 0;
  private totalLen = 0;

  clear(): void {
    this.byDoc.clear();
    this.df.clear();
    this.chunkCount = 0;
    this.totalLen = 0;
  }

  removeDoc(docPath: string): void {
    const chunks = this.byDoc.get(docPath);
    if (!chunks) return;
    for (const c of chunks) {
      for (const t of c.tf.keys()) {
        const n = (this.df.get(t) ?? 1) - 1;
        if (n <= 0) this.df.delete(t);
        else this.df.set(t, n);
      }
      this.chunkCount--;
      this.totalLen -= c.len;
    }
    this.byDoc.delete(docPath);
  }

  /** `fields` (title, purpose, path words) is indexed with every chunk but is not part of the chunk text returned. */
  addDoc(docPath: string, texts: string[], fields = ""): void {
    this.removeDoc(docPath);
    const chunks = texts.map((text): Chunk => {
      const tokens = tokenize(`${fields} ${text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.chunkCount++;
      this.totalLen += tokens.length;
      return { docPath, text, tf, len: tokens.length };
    });
    this.byDoc.set(docPath, chunks);
  }

  /** One result per doc, its best chunk, best first. */
  search(query: string, k = 10): SearchResult[] {
    const terms = [...new Set(tokenize(query))].filter((t) => this.df.has(t));
    if (terms.length === 0 || this.chunkCount === 0) return [];
    const avgLen = this.totalLen / this.chunkCount || 1;
    const idf = new Map(terms.map((t) => {
      const n = this.df.get(t)!;
      return [t, Math.log(1 + (this.chunkCount - n + 0.5) / (n + 0.5))] as const;
    }));

    const minMatched = Math.min(2, terms.length);
    const best = new Map<string, { score: number; text: string }>();
    for (const [docPath, chunks] of this.byDoc) {
      for (const c of chunks) {
        let score = 0;
        let matched = 0;
        for (const t of terms) {
          const f = c.tf.get(t);
          if (f) {
            matched++;
            score += idf.get(t)! * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * c.len) / avgLen)));
          }
        }
        // a chunk matching one incidental word of a longer query is noise (short symptom chunks score high on it)
        if (matched >= minMatched && score > 0 && score > (best.get(docPath)?.score ?? 0)) best.set(docPath, { score, text: c.text });
      }
    }
    return [...best]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, k)
      .map(([path, { score, text }]) => ({ path, title: path, score, snippet: text.slice(0, 200), matchedChunk: text }));
  }
}

/** Weight of the vector cosine in the fused score; BM25 (scaled to its best candidate) gets the rest. Tuned on the train splits only. */
export const COSINE_WEIGHT = 0.7;

/**
 * Doc-level score fusion of the vector and lexical lists (one result per doc each, scores already boosted):
 * `COSINE_WEIGHT * vector + (1 - COSINE_WEIGHT) * bm25 / max(bm25)`. Rank-only RRF let a weak second arm displace a
 * correct vector #1; here a doc needs real lexical evidence to move. Pure vector order when BM25 returns nothing.
 * A doc keeps the vector arm's chunk (the lexical one only when the vector arm missed the doc).
 */
export function fuseScores(vector: SearchResult[], lexical: SearchResult[]): SearchResult[] {
  const top = Math.max(0, ...lexical.map((r) => r.score));
  if (top === 0) return vector;
  const fused = new Map<string, SearchResult>();
  for (const r of lexical) fused.set(r.path, { ...r, score: ((1 - COSINE_WEIGHT) * r.score) / top, lexical: true });
  for (const r of vector) {
    const hit = fused.get(r.path);
    fused.set(r.path, { ...r, score: COSINE_WEIGHT * r.score + (hit?.score ?? 0), lexical: hit ? true : undefined });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

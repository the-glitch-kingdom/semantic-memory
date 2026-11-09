import type { SearchResult } from "./types.js";

const K1 = 1.2;
const B = 0.75;

const STOP = new Set(
  "a an the and or but of to in on at by for with from as is are was were be been it its this that these those do does did how what which when where who why can could should would will we our you your i my not no if then than so there their they them has have had into about after before over under".split(" ")
);

export const tokenize = (s: string): string[] =>
  s.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];

/**
 * Joined spellings of a text's compounds, for presence only: each run of words split by `-` or `_`, or of Title Case words split by
 * a space, gives the join of every adjacent pair and of the whole run. Plain lowercase prose is not joined: that made every
 * adjacent word pair a "name" and multiplied the presence vocabulary by eight (#78 phase 9).
 * shortcut: no stop-word limit inside a run; upgrade if the eval shows a lost negative.
 */
const COMPOUND = /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+|\p{Lu}[\p{L}\p{N}]*(?: \p{Lu}[\p{L}\p{N}]*)+/gu;
export function joinedForms(text: string): string[] {
  const out: string[] = [];
  for (const run of text.match(COMPOUND) ?? []) {
    const parts = run.toLowerCase().split(/[-_ ]/);
    if (parts.length > 2) out.push(parts.join(""));
    for (let i = 0; i + 1 < parts.length; i++) out.push(parts[i] + parts[i + 1]);
  }
  return out;
}

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
/** Doc-level text every chunk is also indexed under: a symptom-style query often matches the title, a frontmatter field or the file name, not the chunk. */
export const bm25Fields = (d: { path: string; title?: string; purpose?: string; fieldText?: string }): string =>
  `${d.fieldText ?? `${d.title ?? ""} ${d.purpose ?? ""}`} ${d.path.replace(/[/.\-_]+/g, " ")}`;

export class Bm25Index {
  private byDoc = new Map<string, Chunk[]>();
  /** every distinct token of a doc (chunks + field text + path words): the term set `cover` reads, kept current by add/removeDoc */
  private docTerms = new Map<string, Set<string>>();
  private df = new Map<string, number>();
  /** df over searchable docs only: what `has` reads, so a doc a search can never return does not make a name present */
  private presenceDf = new Map<string, number>();
  private unsearchable = new Set<string>();
  /** presence-only spelling variants over searchable docs (`auto-fill`, `retry_budget`, `Smart Retry` -> `autofill`, `retrybudget`, `smartretry`); never scored */
  private joinedDf = new Map<string, number>();
  private joinedByDoc = new Map<string, Set<string>>();
  private chunkCount = 0;
  private totalLen = 0;

  clear(): void {
    this.byDoc.clear();
    this.docTerms.clear();
    this.df.clear();
    this.presenceDf.clear();
    this.unsearchable.clear();
    this.joinedDf.clear();
    this.joinedByDoc.clear();
    this.chunkCount = 0;
    this.totalLen = 0;
  }

  removeDoc(docPath: string): void {
    const chunks = this.byDoc.get(docPath);
    if (!chunks) return;
    const searchable = !this.unsearchable.delete(docPath);
    const dec = (m: Map<string, number>, t: string) => {
      const n = (m.get(t) ?? 1) - 1;
      if (n <= 0) m.delete(t);
      else m.set(t, n);
    };
    for (const c of chunks) {
      for (const t of c.tf.keys()) {
        dec(this.df, t);
        if (searchable) dec(this.presenceDf, t);
      }
      this.chunkCount--;
      this.totalLen -= c.len;
    }
    this.byDoc.delete(docPath);
    this.docTerms.delete(docPath);
    for (const j of this.joinedByDoc.get(docPath) ?? []) {
      const n = (this.joinedDf.get(j) ?? 1) - 1;
      if (n <= 0) this.joinedDf.delete(j);
      else this.joinedDf.set(j, n);
    }
    this.joinedByDoc.delete(docPath);
  }

  /** `fields` (title, purpose, path words) is indexed with every chunk but is not part of the chunk text returned. */
  addDoc(docPath: string, texts: string[], fields = "", searchable = true): void {
    this.removeDoc(docPath);
    if (!searchable) this.unsearchable.add(docPath);
    const chunks = texts.map((text): Chunk => {
      const tokens = tokenize(`${fields} ${text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
        if (searchable) this.presenceDf.set(t, (this.presenceDf.get(t) ?? 0) + 1);
      }
      this.chunkCount++;
      this.totalLen += tokens.length;
      return { docPath, text, tf, len: tokens.length };
    });
    this.byDoc.set(docPath, chunks);
    this.docTerms.set(docPath, new Set(chunks.flatMap((c) => [...c.tf.keys()])));
    if (searchable) {
      const joined = new Set<string>();
      for (const text of texts) for (const j of joinedForms(text)) joined.add(j);
      for (const j of joined) this.joinedDf.set(j, (this.joinedDf.get(j) ?? 0) + 1);
      this.joinedByDoc.set(docPath, joined);
    }
  }

  /** True when a searchable doc writes this name with a hyphen, underscore or space (or only its case differs): `term` is lowercase, `_` and `-` removed. */
  hasJoined(term: string): boolean {
    return this.joinedDf.has(term);
  }

  /** True when some searchable doc's chunk holds this token (tokenized, lowercase). Scoring still reads every indexed chunk. */
  has(term: string): boolean {
    return this.presenceDf.has(term);
  }

  /** Number of searchable docs holding this token (tokenized, lowercase). */
  docFreq(term: string): number {
    let n = 0;
    for (const [p, t] of this.docTerms) if (t.has(term) && !this.unsearchable.has(p)) n++;
    return n;
  }

  /** True when the doc holds this token anywhere (chunks, fields, path words). */
  docHas(docPath: string, term: string): boolean {
    return this.docTerms.get(docPath)?.has(term) ?? false;
  }

  /** idf-weighted share of the query's distinct indexed terms that appear anywhere in the doc (0 when the query has none). */
  cover(docPath: string, query: string): number {
    const have = this.docTerms.get(docPath);
    let all = 0;
    let hit = 0;
    for (const t of new Set(tokenize(query))) {
      const n = this.df.get(t);
      if (!n) continue;
      const w = Math.log(1 + (this.chunkCount - n + 0.5) / (n + 0.5));
      all += w;
      if (have?.has(t)) hit += w;
    }
    return all > 0 ? hit / all : 0;
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
      .map(([path, { score, text }]) => ({ path, title: path, score, snippet: text.slice(0, 200), matchedChunk: text, bm25: score }));
  }
}

/**
 * Candidates each list (vector, BM25) contributes before fusion. A pool sized by `limit` made scores and order depend on it
 * (#85): a doc in one list but outside the other lost that share. A fixed floor keeps search(q, k) the first k of search(q, K)
 * for every k <= K <= 20 (the old pool for limit 20 was 60). Above 20 the pool grows, so the guarantee stops there.
 */
export const CANDIDATE_POOL = 60;
export const candidatePool = (limit: number): number => Math.max(CANDIDATE_POOL, limit * 3);

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
    fused.set(r.path, { ...r, score: COSINE_WEIGHT * r.score + (hit?.score ?? 0), lexical: hit ? true : undefined, bm25: hit?.bm25 });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score);
}

/** Most docs a self-query reference samples: enough for a stable median, bounded so a large vault commits fast. */
const SELF_QUERY_MAX = 200;
/** Share of the self-query median a query's best BM25 score must reach to count as lexical evidence. Calibrated on the train splits only. */
export const BM25_FRACTION = 0.8;

/**
 * Corpus-scaled BM25 reference with no labelled data: the median top score of each doc's title used as its own query
 * (an evenly spaced sample of titled docs). BM25 magnitudes depend on the corpus (idf, chunk lengths), so a constant
 * cannot transfer between vaults; the same share of this median does. Null when no doc has a scoring title.
 */
export function bm25SelfTop(index: Bm25Index, docs: { title?: string }[]): number | null {
  const titled = docs.filter((d) => typeof d.title === "string" && d.title); // an old index may hold a number or Date title
  const step = Math.max(1, Math.ceil(titled.length / SELF_QUERY_MAX));
  const tops = titled.filter((_, i) => i % step === 0).map((d) => index.search(d.title!, 1)[0]?.score ?? 0).filter((s) => s > 0).sort((a, b) => a - b);
  return tops.length ? tops[Math.floor(tops.length / 2)] : null;
}

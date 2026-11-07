import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Indexer } from "../core/indexer.js";
import { Embedder } from "../core/embedder.js";
import { GraphBuilder } from "../core/graph.js";
import { VectorIndex } from "../core/vector.js";
import { TextSearch } from "../core/search-text.js";
import { loadIndexFields } from "../core/fields.js";
import { applyCoverage, loadRanking } from "../core/rank.js";
import { Bm25Index, BM25_FRACTION, bm25Fields, bm25SelfTop, fuseScores } from "../core/bm25.js";
import { applyGraphBoost } from "../core/graph-boost.js";
import { excerpt, isWeak, withConfidence } from "../core/confidence.js";
import { isExcludedPath, loadPathClassConfig, pathClassMultiplier, filterPathClass } from "../core/path-class.js";
import { parserInputs, readConsistentMeta, readMeta } from "../core/index-store.js";
import type { IndexedDocument } from "../core/types.js";

export interface SearchCliOptions {
  notes: string;
  query: string;
  limit?: number;
  textOnly?: boolean;
  json?: boolean;
}

export interface SearchHit {
  path: string;
  title?: string;
  score: number;
  snippet?: string;
  matched?: { field: string; text: string };
  mtime?: string;
  /** 0..1 */
  confidence?: number;
  no_strong_match?: true;
}

export async function runSearch(opts: SearchCliOptions): Promise<SearchHit[]> {
  const searcher = await openSearch(opts.notes, { textOnly: opts.textOnly });
  return searcher.search(opts.query, opts.limit ?? 8);
}

type SearchHitRaw = ReturnType<VectorIndex["search"]>[number];

export interface Searcher {
  search(query: string, limit?: number): Promise<SearchHit[]>;
}

/**
 * Load a notes folder once and search it many times — the same scoring the hook's CLI search uses.
 * The hook spawns `search` per prompt; the failure eval reuses one Searcher per corpus.
 */
export async function openSearch(notes: string, opts: { textOnly?: boolean } = {}): Promise<Searcher> {
  const notesPath = resolve(notes);
  if (!existsSync(notesPath)) {
    throw new Error(`notes directory not found: ${notesPath}`);
  }

  const indexer = new Indexer(notesPath);
  const fields = loadIndexFields(notesPath);
  const indexPath = join(notesPath, ".semantic-sidekick-index");

  // Prefer the parsed-doc cache the server committed — avoids re-parsing 500+ files on every hook call.
  // Read-only: a cache from another parser version or caught mid-commit is not used, and nothing is written here.
  const committed = existsSync(indexPath) ? await readConsistentMeta(indexPath, parserInputs(loadPathClassConfig(notesPath), fields)) : null;
  let documents = committed ? await indexer.loadDocsCache(indexPath) : null;
  if (!documents) {
    documents = await indexer.indexAll();
  }
  if (documents.length === 0) return { search: async () => [] };
  const docs = documents;

  if (opts.textOnly) {
    const textSearch = new TextSearch();
    textSearch.setDocuments(docs.filter((d) => !d.generated));
    return { search: async (query, limit = 8) => textHits(textSearch, docs, query, limit) };
  }

  // Hybrid path: load cached index, embed query, search + graph rerank.
  if (!existsSync(indexPath)) {
    throw new Error(`index not built at ${indexPath} — run: semantic-sidekick --notes ${notesPath} --reindex`);
  }
  if (!committed) {
    throw new Error(`index at ${indexPath} is being rewritten or was built by another version — retry, or run --reindex`);
  }

  const embedder = new Embedder();
  await embedder.init();

  const metaPath = join(indexPath, "meta.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf-8")) as { model?: string };
      if (meta.model && meta.model !== embedder.getModel()) {
        throw new Error(`model mismatch (cached=${meta.model}, current=${embedder.getModel()}) — run --reindex`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("model mismatch")) throw e;
    }
  }

  const vectorIndex = new VectorIndex(embedder.getDimensions(), fields.meta_weight);
  const loaded = await vectorIndex.load(indexPath);
  if (!loaded) {
    throw new Error(`could not load vector index at ${indexPath} — run --reindex`);
  }

  const graph = new GraphBuilder();
  await graph.load(indexPath);

  const docByPath = new Map(docs.map((d) => [d.path, d]));
  const bm25 = new Bm25Index();
  for (const d of docs) bm25.addDoc(d.path, d.chunks, bm25Fields(d));
  const pathClass = loadPathClassConfig(notesPath);
  const ranking = loadRanking(notesPath);
  const selfTop = (await readMeta(indexPath))?.bm25SelfTop ?? bm25SelfTop(bm25, docs);
  const bm25Min = selfTop === null ? null : selfTop * BM25_FRACTION;
  return {
    async search(query, limit = 8) {
      const queryEmbed = await embedder.embed(query);
      const semantic = vectorIndex.search(queryEmbed, limit * 3);

      // same order as search_hybrid: each arm adjusted, then fused (the CLI skips decay and usage boosts)
      const adjust = (rs: SearchHitRaw[]) =>
        rs
          .map((r) => {
            const doc = docByPath.get(r.path);
            let score = r.score * pathClassMultiplier(r.path, pathClass);
            if (doc?.loadPriority !== undefined) score *= 1 + (doc.loadPriority - 5) * 0.04;
            return { ...r, score };
          })
          .sort((a, b) => b.score - a.score);
      const all = withConfidence(
        filterPathClass(
          applyCoverage(fuseScores(adjust(applyGraphBoost(semantic, graph)), adjust(bm25.search(query, limit * 3))), query, bm25, graph, ranking, (p) => isExcludedPath(p, pathClass)),
          pathClass
        )
      );
      const weak = isWeak(all, bm25Min);
      const ranked = all.slice(0, limit);

      return ranked.map((r) => ({
        path: r.path,
        title: docByPath.get(r.path)?.title ?? r.title,
        score: r.score,
        confidence: r.confidence,
        snippet: excerpt(r.matchedChunk ?? r.snippet, query),
        ...(r.matched && { matched: r.matched }),
        ...(weak && { no_strong_match: true as const }),
      }));
    },
  };
}

function textHits(textSearch: TextSearch, documents: IndexedDocument[], query: string, limit: number): SearchHit[] {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];
  const scoreByPath = new Map<string, { hits: number; firstSnippet?: string; title?: string; mtime: string }>();
  for (const kw of keywords) {
    const results = textSearch.search({ pattern: kw, limit: 50 });
    for (const r of results) {
      const existing = scoreByPath.get(r.path);
      const doc = documents.find((d) => d.path === r.path);
      if (existing) {
        existing.hits += 1;
      } else {
        scoreByPath.set(r.path, {
          hits: 1,
          firstSnippet: r.snippet,
          title: r.title,
          mtime: doc?.mtime ?? "",
        });
      }
    }
  }
  return Array.from(scoreByPath.entries())
    .map(([path, v]) => ({
      path,
      title: v.title,
      score: v.hits / keywords.length,
      snippet: v.firstSnippet,
      mtime: v.mtime,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from",
  "how", "i", "if", "in", "is", "it", "its", "of", "on", "or", "our", "should", "that",
  "the", "this", "to", "was", "we", "what", "when", "where", "which", "why", "will",
  "with", "you", "your", "have", "has", "had", "but", "not", "so", "any", "all",
  "about", "there", "their", "they", "them", "these", "those", "would", "could",
  "might", "may", "really", "just", "like", "some", "more", "than", "into", "out",
  "up", "down", "need", "want", "get", "got", "also", "very", "much",
]);

function extractKeywords(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
    if (out.length >= 6) break;
  }
  return out;
}

import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Indexer } from "../core/indexer.js";
import { Embedder } from "../core/embedder.js";
import { GraphBuilder } from "../core/graph.js";
import { VectorIndex } from "../core/vector.js";
import { TextSearch } from "../core/search-text.js";
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
  mtime?: string;
}

export async function runSearch(opts: SearchCliOptions): Promise<SearchHit[]> {
  const searcher = await openSearch(opts.notes, { textOnly: opts.textOnly });
  return searcher.search(opts.query, opts.limit ?? 8);
}

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
  const indexPath = join(notesPath, ".semantic-sidekick-index");

  // Prefer the parsed-doc cache written by reindex — avoids re-parsing 500+ files
  // on every hook call. Falls back to a full parse if the cache is missing.
  let documents = existsSync(indexPath) ? await indexer.loadDocsCache(indexPath) : null;
  if (!documents) {
    documents = await indexer.indexAll();
  }
  if (documents.length === 0) return { search: async () => [] };
  const docs = documents;

  if (opts.textOnly) {
    const textSearch = new TextSearch();
    textSearch.setDocuments(docs);
    return { search: async (query, limit = 8) => textHits(textSearch, docs, query, limit) };
  }

  // Hybrid path: load cached index, embed query, search + graph rerank.
  if (!existsSync(indexPath)) {
    throw new Error(`index not built at ${indexPath} — run: semantic-sidekick --notes ${notesPath} --reindex`);
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

  const vectorIndex = new VectorIndex(embedder.getDimensions());
  const loaded = await vectorIndex.load(indexPath);
  if (!loaded) {
    throw new Error(`could not load vector index at ${indexPath} — run --reindex`);
  }

  const graph = new GraphBuilder();
  await graph.load(indexPath);

  const docByPath = new Map(docs.map((d) => [d.path, d]));
  return {
    async search(query, limit = 8) {
      const queryEmbed = await embedder.embed(query);
      const semantic = vectorIndex.search(queryEmbed, limit * 3);
      const graphResults = graph.searchGraph(query, 2);
      const graphPaths = new Set(graphResults.map((r) => r.path));

      const hybrid = semantic
        .map((r) => {
          const doc = docByPath.get(r.path);
          let score = graphPaths.has(r.path) ? r.score * 1.3 : r.score;
          if (doc?.loadPriority !== undefined) {
            score *= 1 + (doc.loadPriority - 5) * 0.04;
          }
          return { ...r, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return hybrid.map((r) => {
        const doc = docByPath.get(r.path);
        return {
          path: r.path,
          title: (r as any).title ?? doc?.title,
          score: r.score,
          snippet: (r as any).snippet,
          mtime: doc?.mtime,
        };
      });
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

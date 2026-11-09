import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { repoRoot } from "../core/skill-evidence.js";
import { Indexer } from "../core/indexer.js";
import { Embedder } from "../core/embedder.js";
import { GraphBuilder } from "../core/graph.js";
import { VectorIndex } from "../core/vector.js";
import { TextSearch } from "../core/search-text.js";
import { loadEmbeddingOverrides, loadIndexFields } from "../core/fields.js";
import { applyCoverage, loadRanking } from "../core/rank.js";
import { Bm25Index, BM25_FRACTION, bm25Fields, bm25SelfTop, fuseScores } from "../core/bm25.js";
import { identifiers, missingTerms, passingTerms } from "../core/identifiers.js";
import { entityCard, knownToCode, loadCodeData, loadExport, splitUndocumented, type CodeData, type EntityCard } from "../core/code-graph.js";
import { fold } from "../core/fold.js";
import { sectionFields } from "../core/section-fields.js";
import { excerpt, isWeak, withConfidence } from "../core/confidence.js";
import { decayForDoc, groundingBlock, loadDecayConfig, type DecayBlock } from "../core/decay.js";
import { isExcludedPath, isSearchableDoc, loadPathClassConfig, pathClassMultiplier, filterPathClass } from "../core/path-class.js";
import { indexRebuilding, parserInputs, readConsistentMeta, readMeta } from "../core/index-store.js";
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
  /** identifiers of the query that no indexed doc contains */
  missing_terms?: string[];
  /** identifiers of the query that exist in code but in no doc */
  undocumented?: { entity: string; path: string }[];
  /** result #1 only: the symbol or file the query names, and the docs citing it */
  entity?: EntityCard;
  /** a server is rebuilding the index this hit came from */
  stale?: true;
  /** present when the note is down-weighted or its age came from a fallback; same block as the MCP tools */
  decay?: DecayBlock;
  grounding?: ReturnType<typeof groundingBlock>;
  /** other docs folded into this result: a marked copy or a pointer, as `path#anchor` */
  also_in?: string[];
  /** best section: heading trail (H1 dropped when it is the title), anchor, up to 3 code refs; same as the MCP tools */
  section?: string;
  anchor?: string;
  code?: string[];
}

export async function runSearch(opts: SearchCliOptions): Promise<SearchHit[]> {
  const searcher = await openSearch(opts.notes, { textOnly: opts.textOnly });
  return searcher.search(opts.query, opts.limit ?? 8);
}

/** One doc path per line, best first, no repeats: the stdout contract of hewtd's reconcile.search_command. */
export function pathsOutput(hits: SearchHit[]): string {
  const paths = [...new Set(hits.map((h) => h.path))];
  return paths.length ? paths.join("\n") + "\n" : "";
}

type SearchHitRaw = ReturnType<VectorIndex["search"]>[number];

export interface Searcher {
  search(query: string, limit?: number): Promise<SearchHit[]>;
}

/**
 * Load a notes folder once and search it many times — the same scoring the hook's CLI search uses.
 * The hook spawns `search` per prompt; the failure eval reuses one Searcher per corpus.
 */
export async function openSearch(notes: string, opts: { textOnly?: boolean; granularity?: "section" | "doc" } = {}): Promise<Searcher> {
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

  const embedder = new Embedder(undefined, undefined, undefined, undefined, loadEmbeddingOverrides(notesPath));
  await embedder.init();

  const metaPath = join(indexPath, "meta.json");
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf-8")) as { model?: string; pooling?: string; queryPrompt?: string };
      if (meta.model && (meta.model !== embedder.getModel() || (meta.pooling ?? "mean") !== embedder.getPooling() || (meta.queryPrompt ?? "") !== embedder.getQueryPrompt())) {
        throw new Error(`model mismatch (cached=${meta.model}/${meta.pooling ?? "mean"}, current=${embedder.getModel()}/${embedder.getPooling()}) — run --reindex`);
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
  const pathClass = loadPathClassConfig(notesPath);
  const bm25 = new Bm25Index();
  for (const d of docs) bm25.addDoc(d.path, d.chunks, bm25Fields(d), isSearchableDoc(d, pathClass));
  const ranking = loadRanking(notesPath);
  const decayConfig = loadDecayConfig(notesPath);
  const decayOf = (path: string) => (decayConfig.enabled && docByPath.get(path) ? decayForDoc(docByPath.get(path)!, decayConfig) : { multiplier: 1 });
  const selfTop = (await readMeta(indexPath))?.bm25SelfTop ?? bm25SelfTop(bm25, docs);
  const paths = docs.filter((d) => isSearchableDoc(d, pathClass)).map((d) => d.path).join("\n").toLowerCase();
  // the export is one file read: folding needs its duplicates and pointers, not the git calls of the full code graph
  let exp: CodeData | null | undefined;
  const exported = () => (exp !== undefined ? exp : (exp = loadExport(repoRoot(notesPath), notesPath, new Set(docs.map((d) => d.path)))));
  let codeP: Promise<CodeData | null> | undefined;
  const bm25Min = selfTop === null ? null : selfTop * BM25_FRACTION;
  return {
    async search(query, limit = 8) {
      const queryEmbed = await embedder.embedQuery(query);
      const semantic = vectorIndex.search(queryEmbed, limit * 3);

      // same order as search_hybrid: each arm adjusted, then fused (the CLI skips usage boosts)
      const adjust = (rs: SearchHitRaw[]) =>
        rs
          .map((r) => {
            const doc = docByPath.get(r.path);
            let score = r.score * pathClassMultiplier(r.path, pathClass) * decayOf(r.path).multiplier;
            if (doc?.loadPriority !== undefined) score *= 1 + (doc.loadPriority - 5) * 0.04;
            return { ...r, score };
          })
          .sort((a, b) => b.score - a.score);
      const filtered = filterPathClass(
        applyCoverage(fuseScores(adjust(semantic), adjust(bm25.search(query, limit * 3))), query, bm25, graph, ranking, (p) => isExcludedPath(p, pathClass)),
        pathClass
      );
      const all = withConfidence(opts.granularity === "doc" ? filtered : fold(filtered, docByPath, exported()));
      // the code is read only for a query that names an identifier: it costs a git call
      const code = identifiers(query, () => true).length || missingTerms(query, bm25, paths, () => true).length ? await (codeP ??= loadCodeData(notes, docs).catch((): CodeData | null => null)) : null;
      const absent = missingTerms(query, bm25, paths, knownToCode(code));
      const { missing, undocumented } = splitUndocumented(absent, code);
      const passing = passingTerms(query, bm25, paths, all.slice(0, 3).map((r) => r.path), knownToCode(code));
      const weak = isWeak(all, bm25Min) || absent.length > 0 || passing.length > 0;
      const scoreOf = new Map(all.map((r) => [r.path, r.score]));
      const card = entityCard(query, code, docByPath, (p) => scoreOf.get(p) ?? -Infinity);
      const stale = await indexRebuilding(indexPath);
      const ranked = all.slice(0, limit);

      return ranked.map((r, i) => {
        const title = docByPath.get(r.path)?.title ?? r.title;
        const sec = sectionFields(docByPath.get(r.path), r.matchedChunk ?? r.snippet, title);
        return {
        path: r.path,
        title,
        score: r.score,
        confidence: r.confidence,
        snippet: excerpt(sec.text, query),
        ...(r.matched && { matched: r.matched }),
        ...((r as any).also_in && { also_in: (r as any).also_in }),
        ...(i === 0 && card && { entity: card }),
        ...(weak && { no_strong_match: true as const, ...(missing.length && { missing_terms: missing }), ...(passing.length && { passing_terms: passing }), ...(undocumented.length && { undocumented }) }),
        ...(stale && { stale: true as const }),
        ...(decayOf(r.path).block && { decay: decayOf(r.path).block }),
        ...(decayOf(r.path).grounding && { grounding: decayOf(r.path).grounding }),
        ...(opts.granularity !== "doc" && { ...(sec.section && { section: sec.section }), ...(sec.anchor && { anchor: sec.anchor }), ...(sec.code && { code: sec.code }) }),
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

export interface IndexedDocument {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  wikilinks: string[];
  /** vault-relative targets of markdown `[text](x.md)` links; absent in caches from before schemaVersion 2 */
  mdLinks?: string[];
  tags: string[];
  headers: string[];
  chunks: string[];
  /** ISO timestamp — prefers frontmatter last_updated/updated/date/lastmod, falls back to fs.stat mtime */
  mtime: string;
  // Optional fields sourced from frontmatter when present (e.g. hit-em-with-the-docs schema)
  loadPriority?: number;   // 1-10 relevance weight; boosts search scores
  status?: string;         // draft | active | deprecated | archived
  tier?: string;           // guide | standard | example | reference | admin
  domains?: string[];      // domain categories e.g. ["api", "security"]
  purpose?: string;        // one-sentence summary for richer search context
  /** knowledge-base fact ids from `symptoms[].cites` / `cites`; absent in caches from before schemaVersion 3 */
  cites?: string[];
  /** vault path this doc was archived from (`archived_from`) */
  archivedFrom?: string;
  relatedDocs?: string[];  // explicit related doc paths from frontmatter (related_docs field)
}

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  matchedChunk?: string;
  /** raw vector cosine of the matched chunk, before any boost (set by VectorIndex.search, kept through fusion) */
  cosine?: number;
  /** the lexical (BM25) arm also returned this doc */
  lexical?: boolean;
  /** 0..1, see core/confidence.ts */
  confidence?: number;
  /** cross-encoder logit, set only on results the reranker scored */
  rerankScore?: number;
  mtime?: string;
  loadPriority?: number;
  status?: string;
  tier?: string;
  domains?: string[];
}

export interface GraphNode {
  path: string;
  title: string;
  tags: string[];
  linkCount: number;
  backlinkCount: number;
  loadPriority?: number;  // present when frontmatter load_priority is set
  status?: string;        // present when frontmatter status is set
}

/** `link` = markdown link, `related` = frontmatter related_docs, `tag` = shared rare tag */
/** `cites` = playbook symptom -> knowledge-base fact, `supersedes` = live doc -> its archived copy (`archived_from`), `same-incident` = files under one `incidents/<id>/` */
export type EdgeType = "link" | "wikilink" | "related" | "tag" | "cites" | "supersedes" | "same-incident";

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  orphanCount: number;
  mostConnected: Array<{ path: string; connections: number }>;
  density: number;
}

export type IndexState = "empty" | "loading" | "stale" | "indexing" | "ready";

export interface IndexProgress {
  state: IndexState;
  embedded?: number;
  total?: number;
}

export interface VaultStats {
  totalNotes: number;
  totalChunks: number;
  totalEmbeddings: number;
  embeddingDimensions: number;
  embeddingModel: string;
  embeddingRuntime: "native" | "wasm" | "unknown";
  graphNodes: number;
  graphEdges: number;
  indexSize: number;
  lastIndexed: string | null;
  stale?: boolean;
  indexState: IndexState;
  indexProgress?: { embedded: number; total: number };
}

export interface UpdateNoteOptions {
  mode: "overwrite" | "append" | "prepend" | "patch-by-heading";
  heading?: string;
}

export interface SearchTextOptions {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  pathGlob?: string;
  tagFilter?: string[];
  limit?: number;
}

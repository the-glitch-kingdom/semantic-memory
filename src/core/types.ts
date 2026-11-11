export interface IndexedDocument {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  wikilinks: string[];
  /** vault-relative targets of markdown `[text](x.md)` links; absent in caches from before schemaVersion 2 */
  mdLinks?: string[];
  /** inline code spans and non-`.md` link targets (vault-relative, `../` kept); absent in caches from before schemaVersion 8 */
  codeRefs?: string[];
  /** what the code says about this doc (drift, dead refs, verdict); set at index time from the export or the span fallback, absent when there is nothing to report */
  grounding?: Grounding;
  tags: string[];
  headers: string[];
  chunks: string[];
  /** every flat section of the body (anchors as hit-em-with-the-docs computes them); `hash` is of the normalized section text. Absent in caches from before schemaVersion 9 */
  sections?: { anchor: string; trail: string; hash: string; /** raw code refs inside the section, at most 3 */ code?: string[] }[];
  /** per body chunk, the index into `sections` of the section the chunk answers for */
  chunkSection?: number[];
  /** metadata chunks embedded beside the body (purpose / summary / description, symptom phrases) */
  meta?: { field: string; text: string }[];
  /** frontmatter field text every BM25 chunk of the doc is also indexed under */
  fieldText?: string;
  /** `generated: true`: no chunks, not a graph node, never returned */
  generated?: boolean;
  /** ISO timestamp — prefers frontmatter last_updated/updated/date/lastmod, falls back to fs.stat mtime */
  mtime: string;
  /** ISO date of the last git commit of these exact bytes (decay `git` mode); absent outside a repo, untracked or edited since the commit */
  gitDate?: string;
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
  /** set when a metadata chunk (not the body) won the doc; the snippet is still the best body chunk */
  matched?: { field: string; text: string };
  /** raw vector cosine of the matched chunk, before any boost (set by VectorIndex.search, kept through fusion) */
  cosine?: number;
  /** the lexical (BM25) arm also returned this doc */
  lexical?: boolean;
  /** raw BM25 score of the doc's best chunk, before any boost (kept through fusion) */
  bm25?: number;
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
export type EdgeType = "link" | "wikilink" | "related" | "tag" | "cites" | "supersedes" | "same-incident" | "cites_code" | "defined_in";
/** `cites_code` = doc -> code file or symbol, `defined_in` = symbol -> its file; neither is a link between notes, so neither is in LINK_EDGE_TYPES */

export interface GraphEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
}

export interface GraphStats {
  /** documents only; `codeNodes` counts the code: and symbol: nodes */
  totalNodes: number;
  totalEdges: number;
  orphanCount: number;
  mostConnected: Array<{ path: string; connections: number }>;
  density: number;
  codeNodes: number;
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
  /** the code graph's last load: where it came from (hewtd export, span/link fallback, none = not a git repo or failed) and how long it took */
  codeGraph?: { source: "export" | "fallback" | "none"; loadMs: number };
  /** share of searchable notes carrying each indexed frontmatter field (index_fields.lexical) */
  fieldCoverage?: { docs: number; fields: Record<string, number> };
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

/** Code facts about one doc: files changed after the doc was written or verified, file refs that no longer exist, and hewtd's verdict. */
export interface Grounding {
  source: "export" | "export+live" | "code-spans";
  verdict?: string;
  /** the export is older than the code and some refs were re-checked live */
  stale?: true;
  code_drift: string[];
  dead_refs: string[];
}

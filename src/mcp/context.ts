import { mkdir, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { groundDocs, loadCodeData, type CodeData } from "../core/code-graph.js";
import { repoRoot } from "../core/skill-evidence.js";
import { Indexer, sourcePathClass } from "../core/indexer.js";
import { Embedder } from "../core/embedder.js";
import { Reranker, loadRerankConfig } from "../core/reranker.js";
import { GraphBuilder, loadExcludeHubs } from "../core/graph.js";
import { VectorIndex, docChunks } from "../core/vector.js";
import { Bm25Index, BM25_FRACTION, bm25Fields, bm25SelfTop } from "../core/bm25.js";
import { loadEmbeddingOverrides, loadIndexFields, type IndexFields } from "../core/fields.js";
import { loadRanking, type RankingConfig } from "../core/rank.js";
import { TextSearch } from "../core/search-text.js";
import { NoteCrud } from "../core/crud.js";
import { FrontmatterManager, TagManager } from "../core/frontmatter.js";
import { SessionManager, deriveSessionDir } from "../core/session.js";
import { decayForDoc, groundingBlock, loadDecayConfig, normalizeVerifiedDate, type DecayBlock, type DecayConfig } from "../core/decay.js";
import { gitBlobId, gitBodyDates, gitCommitDates } from "../core/git-dates.js";
import { pathClassMultiplier, filterPathClass as filterPathClassBy, isExcludedPath, isSearchableDoc, type PathClassConfig } from "../core/path-class.js";
import { computeUsageBoost, loadUsageBoostConfig, loadCitationCounts, type UsageBoostConfig } from "../core/usage-boost.js";
import { reconcile, sha256, type Manifest } from "../core/reconcile.js";
import { commitIndex, filesMatchMeta, ignoreGlobsHash, metaMtime, parserInputs, parserMatches, readMeta } from "../core/index-store.js";
import type { IndexedDocument, IndexState } from "../core/types.js";

export interface ServerOptions {
  /** @deprecated No effect: the index is reconciled on demand, nothing watches the tree. Kept so `--no-watch` keeps working. */
  watch?: boolean;
  waitForReady?: boolean;
  /** With waitForReady: rebuild everything instead of reconciling a warm cache (`--reindex`). */
  forceReindex?: boolean;
  /** Minimum gap between on-demand reconciles. Default 2000. */
  reconcileThrottleMs?: number;
  model?: string;
  workers?: number;
  batchSize?: number;
  quantized?: boolean;
  /** overrides embedding.pooling / embedding.query_prompt in vault.schema.yml, which override the model's own config */
  pooling?: "mean" | "cls";
  queryPrompt?: string;
  readOnly?: boolean;
  /** createServer: do not load or build the index at start (the CLI's sources-only search). */
  skipStartIndex?: boolean;
  /**
   * A locked source (a cold generation, a frozen folder): the cached index is served as loaded and `ensureFresh` never
   * reconciles; its `archive/` is searchable (the 0.3 multiplier stays). A changed folder is the registry's checksum check, not reconcile.
   */
  locked?: boolean;
  /** Paths (relative to the source) left out of the index whole: files a secrets scan flagged. */
  skipFiles?: string[];
  /** Where the index lives. Default `<notes>/.semantic-sidekick-index`; a federation source's goes under the primary's. */
  indexPath?: string;
  /** Use this embedder instead of making one (federation sources share the primary's model and pooling). */
  embedder?: Embedder;
  /** false: searches and reads are not logged (the retrieval eval must not feed usage-boost). Default true. */
  telemetry?: boolean;
  onProgress?: (embedded: number, total: number) => void;
}

export interface UsageBlock {
  citations: number;
  multiplier: number;
}

export interface EnrichedResult {
  mtime?: string;
  loadPriority?: number;
  status?: string;
  tier?: string;
  domains?: string[];
  decay?: DecayBlock;
  usage?: UsageBlock;
}

export interface ServerContext {
  notesPath: string;
  indexPath: string;
  /** Where search/read telemetry is appended: the index dir when read-only, else undefined (the session dir). */
  telemetryDir?: string;
  options: ServerOptions;

  indexer: Indexer;
  /** `index_fields` from vault.schema.yml */
  fields: IndexFields;
  /** `ranking` from vault.schema.yml: whole-doc coverage and link prior */
  ranking: RankingConfig;
  isExcluded(path: string): boolean;
  embedder: Embedder;
  /** null when `rerank.enabled` is off (vault.schema.yml) */
  reranker: Reranker | null;
  graph: GraphBuilder;
  textSearch: TextSearch;
  bm25: Bm25Index;
  /** Best raw BM25 score below which the lexical arm is no evidence for this index (null: no reference, cosine alone decides). */
  bm25Min(): number | null;
  crud: NoteCrud;
  frontmatterManager: FrontmatterManager;
  tagManager: TagManager;
  sessions: SessionManager;

  getDocuments(): IndexedDocument[];
  getDocByPath(): Map<string, IndexedDocument>;
  /** lowercased paths of the searchable docs, joined: the path half of the presence test */
  searchablePaths(): string;
  /** code data behind the graph's code nodes (null outside a git repo) */
  getCode(): CodeData | null;
  /** last code-graph load, undefined before the first one lands */
  getCodeLoad(): { source: "export" | "fallback" | "none"; loadMs: number } | undefined;
  getVectorIndex(): VectorIndex | null;
  getIndexState(): IndexState;
  getIndexProgress(): { embedded: number; total: number };

  tryLoadCachedIndex(): Promise<boolean>;
  fullIndex(): Promise<void>;
  backgroundIndex(): void;
  /** Reconcile with the tree before a tool answers (throttled, serialized). */
  ensureFresh(): Promise<void>;
  /** Make the next ensureFresh() reconcile regardless of the throttle (after a write). */
  invalidate(): void;
  /** Reconcile now, ignoring the throttle. */
  reconcileNow(): Promise<void>;
  /** True from a warm load until the first reconcile has checked the cache against the tree. */
  isStale(): boolean;
  /** Write any pending incremental change to disk now. */
  flushIndex(): Promise<void>;
  isIndexingInFlight(): boolean;

  textResponse(text: string): { content: { type: "text"; text: string }[] };
  indexingMessage(): string;
  enrichResult<T extends { path: string }>(r: T): T & EnrichedResult;
  applyPriorityBoost(score: number, path: string): number;
  /**
   * Apply confidence decay to a scored result: multiply its score by the decay
   * multiplier and, when the note is actually decayed (multiplier < 1), attach a
   * `decay` block for the agent to see. No-op when decay is disabled or the note
   * is fresh. Semantic ranking signal only — callers wire it into
   * search_semantic / search_hybrid, never search_text / search_graph.
   */
  applyDecay<T extends { path: string; score: number }>(r: T): T & { decay?: DecayBlock; grounding?: ReturnType<typeof groundingBlock> };
  /**
   * Apply the path-class multiplier (e.g. archive/** down-weight) to a scored
   * result. Composes multiplicatively with decay/priority at the same rank site.
   * No-op when disabled or no glob matches.
   */
  applyPathClass<T extends { path: string; score: number }>(r: T): T;
  /** Drops `path_class.exclude` matches (archive by default) and archived copies of live chunks. */
  filterPathClass<T extends { path: string; matchedChunk?: string }>(results: T[]): T[];
  /**
   * Apply the usage-feedback boost (v1.5): notes cited repeatedly (per the
   * selection log) earn a bounded rank boost (≤ cap), attaching a `usage` block
   * when boosted. Composes multiplicatively at the same rank site as decay/
   * path-class/priority. No-op when disabled or the note has no citations. Call
   * `refreshUsageBoost()` once before a batch so the citation snapshot is current.
   */
  applyUsageBoost<T extends { path: string; score: number }>(r: T): T & { usage?: UsageBlock };
  /** Refresh the cached citation snapshot from the selection log (TTL-guarded). */
  refreshUsageBoost(): Promise<void>;
  applyDateFilter<T extends { path: string }>(
    results: T[],
    modifiedAfter?: string,
    modifiedBefore?: string
  ): T[];
}

export async function buildContext(notesPath: string, options: ServerOptions = {}): Promise<ServerContext> {
  const indexPath = options.indexPath ?? join(notesPath, ".semantic-sidekick-index");
  await mkdir(indexPath, { recursive: true });

  const rules = { skip: options.skipFiles, keepArchive: options.locked };
  const indexer = new Indexer(notesPath, rules);
  const fields = loadIndexFields(notesPath);
  const embedder =
    options.embedder ??
    new Embedder(options.model, options.workers, options.batchSize, options.quantized, {
      ...loadEmbeddingOverrides(notesPath),
      ...(options.pooling ? { pooling: options.pooling } : {}),
      ...(options.queryPrompt !== undefined ? { queryPrompt: options.queryPrompt } : {}),
    });
  const rerankConfig = loadRerankConfig(notesPath);
  const reranker = rerankConfig.enabled ? new Reranker(rerankConfig.model) : null;
  const graph = new GraphBuilder({
    excludeHubs: loadExcludeHubs(notesPath),
    isArchived: (p) => isExcludedPath(p, getPathClassConfig()),
  });
  const textSearch = new TextSearch();
  const bm25 = new Bm25Index();
  const crud = new NoteCrud(notesPath);
  const frontmatterManager = new FrontmatterManager(notesPath);
  const tagManager = new TagManager(notesPath);
  const sessions = new SessionManager(deriveSessionDir(notesPath));

  let documents: IndexedDocument[] = [];
  let docByPath = new Map<string, IndexedDocument>();
  let codeData: CodeData | null = null;
  let searchablePathsFor: Map<string, IndexedDocument> | null = null; // the docByPath the cached string was built from
  let searchablePathsStr = "";
  let vectorIndex: VectorIndex | null = null;
  let indexState: IndexState = "empty";
  let indexProgress = { embedded: 0, total: 0 };
  let indexingPromise: Promise<void> | null = null;

  // Pull-based freshness: no watcher. The manifest says what the index last saw of each file;
  // reconcile() diffs it against the tree before a tool answers.
  let manifest: Manifest = {};
  let generation = 0; // of the commit this process last loaded or wrote
  let lastMetaMtime = 0; // meta.json as we last saw it; a different value means another process committed
  let stale = false; // loaded from disk, first reconcile not finished
  let upgrading = false; // the loaded index was written by an older parser: served as-is until a full rebuild replaces it
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let fullIndexing = 0;
  let reconcileInFlight: Promise<void> | null = null;
  let lastReconcileAt = 0;
  const throttleMs = options.reconcileThrottleMs ?? 2000;
  const SAVE_DEBOUNCE_MS = 2000;
  const SAVE_INTERVAL = 100; // chunks embedded between partial saves of a long build
  const COMPACT_RATIO = 0.3;

  // chunk text -> embedding, loaded on first need (an unchanged warm start never reads it)
  let vectors = new Map<string, Float32Array>();
  let vectorsLoaded = false;
  let vectorsDirty = false;
  // cls vectors get their own keys; mean keeps the pre-1.12 key so MiniLM vectors are reused untouched
  const vectorKey = (text: string) => sha256(`${embedder.getModel()}${embedder.getPooling() === "cls" ? "\0cls" : ""}\0${text}`);
  /**
   * v1.7.2 and v1.8 keyed vectors `path:chunkIndex`; their hnsw-meta.json holds the text each label was built from.
   * Re-key those to the text key so an upgrade re-embeds only chunks whose text changed. The old keys are pruned at the next save.
   */
  async function rekeyPositional(map: Map<string, Float32Array>) {
    if (![...map.keys()].some((k) => k.includes(":"))) return;
    try {
      const old: ({ docPath: string; chunkIndex: number; text: string } | null)[] = JSON.parse(await readFile(join(indexPath, "hnsw-meta.json"), "utf-8"));
      for (const m of old) {
        const v = m && map.get(`${m.docPath}:${m.chunkIndex}`);
        if (v) map.set(vectorKey(m.text), v);
      }
      vectorsDirty = true;
    } catch {
      /* no usable hnsw-meta.json: the chunks are embedded again */
    }
  }
  async function getVectors() {
    if (!vectorsLoaded) {
      vectors = await embedder.loadEmbeddings(indexPath);
      await rekeyPositional(vectors);
      vectorsLoaded = true;
    }
    return vectors;
  }

  // reconcile, full index and save all mutate the same state: one at a time
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };

  // code refs of the docs (export or span fallback); null = not a git repo, so the graph stays doc-only
  let lastCodeStamp = "";
  /** export + HEAD reflog mtimes: one stat each, no spawn */
  function codeStamp(): string {
    const m = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
    const root = repoRoot(notesPath);
    return `${m(join(root, ".hewtd", "graph.json"))}:${m(join(root, ".git", "logs", "HEAD"))}`;
  }
  let codeLoad: { source: "export" | "fallback" | "none"; loadMs: number; export_commit?: string | null; behind_head?: number | null; files_changed_since?: number | null } | undefined;
  async function loadCode(docs: IndexedDocument[]): Promise<CodeData | null> {
    lastCodeStamp = codeStamp();
    const t0 = Date.now();
    try {
      const code = await loadCodeData(notesPath, docs);
      groundDocs(docs, code);
      codeLoad = { source: !code ? "none" : [...code.docs.values()].some((d) => d.source !== "code-spans") ? "export" : "fallback", loadMs: Date.now() - t0, ...(code?.export && { export_commit: code.export.commit, behind_head: code.export.behind, files_changed_since: code.export.changed }) };
      return code;
    } catch (e: any) {
      codeLoad = { source: "none", loadMs: Date.now() - t0 };
      process.stderr.write(`Code graph skipped: ${e?.message ?? e}\n`);
      return null;
    }
  }

  /**
   * Step 2 of a state swap: the code graph (grounding, code edges, entity cards) comes after the docs are installed, so a slow
   * `git log` never leaves a new vector index without doc metadata. Responses are marked stale until it lands.
   */
  let codePending = 0;
  let lastCodeLoad: Promise<void> = Promise.resolve();
  function applyCode(docs: IndexedDocument[]): Promise<void> {
    codePending++;
    const before = JSON.stringify(docs.map((d) => d.grounding));
    return loadCode(docs)
      .then((code) => {
        if (documents !== docs) return; // a later swap installed newer docs and runs its own load (an older load finishing last must not overwrite its code)
        codeData = code;
        graph.buildFromDocuments(docs, code);
        // the CLI reads grounding from the saved cache: a grounding that lands after the swap's own save would otherwise never reach it
        if (before !== JSON.stringify(docs.map((d) => d.grounding))) { dirty = true; scheduleSave(); }
      })
      .finally(() => { codePending--; });
  }

  function setDocuments(docs: IndexedDocument[], code: CodeData | null = null) {
    documents = docs;
    docByPath = new Map(docs.map((d) => [d.path, d]));
    textSearch.setDocuments(docs);
    graph.buildFromDocuments(docs, code);
  }

  let selfTopCache: number | null | undefined; // undefined = not computed for the current docs
  const selfTop = () => (selfTopCache === undefined ? (selfTopCache = bm25SelfTop(bm25, documents)) : selfTopCache);

  /** Whole-index load or rebuild: drop the lexical index and refill it from these docs. */
  function resetBm25(docs: IndexedDocument[]) {
    selfTopCache = undefined;
    bm25.clear();
    for (const d of docs) bm25.addDoc(d.path, d.chunks, bm25Fields(d), isSearchableDoc(d, getPathClassConfig()));
  }

  /** Adopt what another process (or an earlier run) committed. False leaves the current state alone. */
  async function loadFromDisk(allowOlder = false): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const meta = await readMeta(indexPath);
      if (!meta) return false;
      const older = !parserMatches(meta, parserKey());
      if (older && !allowOlder) return false;
      if (meta.model !== embedder.getModel() || meta.dimensions !== embedder.getDimensions() || (meta.pooling ?? "mean") !== embedder.getPooling() || (meta.queryPrompt ?? "") !== embedder.getQueryPrompt()) {
        process.stderr.write(`Model, pooling or query prompt changed (${meta.model} → ${embedder.getModel()}, ${meta.pooling ?? "mean"} → ${embedder.getPooling()}), forcing reindex\n`);
        return false;
      }
      // an older index (v1.7.2 and v1.8 wrote no commit record) is only served, never extended: the check is for current ones
      if (!older && !(await filesMatchMeta(indexPath, meta))) {
        await new Promise((r) => setTimeout(r, 100)); // a commit may be mid-rename
        continue;
      }
      const tempVector = new VectorIndex(embedder.getDimensions(), fields.meta_weight);
      const docs = await indexer.loadDocsCache(indexPath);
      let loadedManifest: Manifest | null = older ? {} : null;
      try {
        if (!older) loadedManifest = JSON.parse(await readFile(join(indexPath, "manifest.json"), "utf-8"));
      } catch {
        /* handled below */
      }
      if (!docs || !loadedManifest || !(await tempVector.load(indexPath))) return false;
      if ((await readMeta(indexPath))?.generation !== meta.generation) continue; // committed under us: read again

      manifest = loadedManifest;
      vectorIndex = tempVector;
      generation = meta.generation ?? 0;
      upgrading = older;
      resetBm25(docs);
      setDocuments(docs);
      void applyCode(docs);
      selfTopCache = meta.bm25SelfTop; // undefined (older index): computed on first use
      return true;
    }
    return false;
  }

  async function tryLoadCachedIndex(): Promise<boolean> {
    try {
      indexState = "loading";
      await embedder.init();
      lastMetaMtime = await metaMtime(indexPath);
      if (!(await loadFromDisk(true))) return false;
      if (options.locked) {
        if (upgrading) { upgrading = false; return false; } // an older parser's index is rebuilt, never served from a source nothing reconciles
        indexState = "ready";
        return true;
      }
      stale = true; // served now, checked against the tree by the first reconcile
      indexState = "stale";
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bring the index in line with the tree. `rebuild` ignores the loaded state and re-parses every
   * file (vectors are still reused by chunk text), swapping the result in when done.
   */
  async function sync(rebuild = false): Promise<void> {
    if (!rebuild) {
      const m = await metaMtime(indexPath);
      if (m && m !== lastMetaMtime) {
        lastMetaMtime = m;
        await loadFromDisk().catch(() => false);
      }
    }

    const plan = await reconcile(notesPath, rebuild ? {} : manifest, options.skipFiles, options.locked);
    if (!plan.changed && !rebuild) {
      // the tree is unchanged but the code may not be: a new export or a commit moves the stamp
      if (codeStamp() !== lastCodeStamp) {
        void applyCode(documents);
      }
      if (stale || indexState === "stale") {
        stale = false;
        indexState = "ready";
      }
      return;
    }

    // plan.parse order, not completion order: HNSW is order-sensitive and results should be reproducible
    const parsed = (
      await Promise.all(
        plan.parse.map(async (file) => {
          try {
            return await indexer.indexFile(join(notesPath, file), file);
          } catch (err: any) {
            process.stderr.write(`Skipping ${file}: ${err?.message ?? err}\n`);
            // keep what we knew so the file is retried on the next pass
            const prev = rebuild ? undefined : manifest[file];
            if (prev) plan.manifest[file] = prev;
            else delete plan.manifest[file];
            return null;
          }
        })
      )
    ).filter((d): d is IndexedDocument => d !== null);

    const cache = await getVectors();
    const unseen = new Map<string, string>();
    for (const doc of parsed) for (const { text } of docChunks(doc)) if (!cache.has(vectorKey(text))) unseen.set(vectorKey(text), text);

    const totalChunks = parsed.reduce((n, d) => n + docChunks(d).length, 0);
    const toEmbed = [...unseen.entries()];
    indexProgress = { embedded: totalChunks - toEmbed.length, total: totalChunks };
    if (toEmbed.length > 0) {
      await embedder.init();
      let sinceSave = 0;
      await embedder.embedBatch(
        toEmbed.map(([, text]) => text),
        async (done, _total, embeddings) => {
          if (!embeddings) return;
          const start = done - embeddings.length;
          embeddings.forEach((e, i) => cache.set(toEmbed[start + i][0], e));
          vectorsDirty = true;
          sinceSave += embeddings.length;
          indexProgress = { embedded: totalChunks - toEmbed.length + done, total: totalChunks };
          options.onProgress?.(indexProgress.embedded, totalChunks);
          if (sinceSave >= SAVE_INTERVAL) {
            await embedder.saveEmbeddings(cache, indexPath); // a killed long build resumes from here
            sinceSave = 0;
          }
        }
      );
    }

    // Decay `git` mode: one `git log` per build or reconcile dates the docs that have no usable last_verified and are new, changed
    // or still undated, by its last body change. A doc whose bytes differ from its last commit stays undated (decay then takes the penalty).
    const gitDates = new Map<string, string>();
    if (getDecayConfig().enabled && getDecayConfig().missing_last_verified === "git") {
      const unverified = (d: IndexedDocument) => !(Date.parse(normalizeVerifiedDate(d.frontmatter?.last_verified) ?? "") <= Date.now());
      const todo = [...parsed, ...(rebuild ? [] : documents.filter((d) => !d.gitDate))].filter(unverified);
      if (todo.length > 0) {
        const commits = await gitCommitDates(notesPath);
        const unchanged: string[] = [];
        for (const d of todo) {
          const c = commits.get(d.path)?.[0];
          if (c && gitBlobId(await readFile(join(notesPath, d.path)).catch(() => Buffer.alloc(0))) === c.blob) unchanged.push(d.path);
        }
        // the date is the last change of the body, so a frontmatter-only commit (a bulk re-tag) does not make an old note look fresh
        for (const [path, ms] of await gitBodyDates(notesPath, commits, unchanged)) gitDates.set(path, new Date(ms).toISOString());
      }
    }

    // From here on everything is synchronous: a search never sees a half-applied change.
    selfTopCache = undefined;
    for (const d of [...parsed, ...documents]) {
      const date = gitDates.get(d.path);
      if (date) d.gitDate = date;
    }
    const byPath = new Map(rebuild ? [] : documents.map((d) => [d.path, d] as const));
    const vec = rebuild || !vectorIndex ? new VectorIndex(embedder.getDimensions(), fields.meta_weight) : vectorIndex;
    if (rebuild) bm25.clear();
    for (const path of [...plan.gone, ...parsed.map((d) => d.path)]) {
      vec.removeDoc(path);
      bm25.removeDoc(path);
      byPath.delete(path);
    }
    for (const doc of parsed) {
      byPath.set(doc.path, doc);
      bm25.addDoc(doc.path, doc.chunks, bm25Fields(doc), isSearchableDoc(doc, getPathClassConfig()));
      const chunks = docChunks(doc);
      vec.addChunks(chunks.map((c) => cache.get(vectorKey(c.text))!), chunks);
    }
    const docs = [...byPath.values()];
    let next = vec;
    if (vec.deletedRatio() > COMPACT_RATIO) {
      // markDelete leaves the node in the graph; past this ratio a rebuild from cached vectors is cheaper than carrying them
      const chunks = docs.flatMap(docChunks);
      if (chunks.every((c) => cache.has(vectorKey(c.text)))) {
        next = new VectorIndex(embedder.getDimensions(), fields.meta_weight);
        next.build(chunks.map((c) => cache.get(vectorKey(c.text))!), chunks);
      }
    }

    manifest = plan.manifest;
    vectorIndex = next;
    setDocuments(docs);
    lastCodeLoad = applyCode(docs);
    stale = false;
    dirty = true;
    // a forced rebuild is ready only once it is on disk (fullIndex), so "ready" always means a persisted index
    if (!rebuild) {
      indexState = "ready";
      scheduleSave();
    }
  }

  function scheduleSave(delay = SAVE_DEBOUNCE_MS) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      serial(save).catch((err) => process.stderr.write(`Index save error: ${err?.message ?? err}\n`));
    }, delay);
    saveTimer.unref();
  }

  /** Atomic save (see commitIndex). Runs inside `serial`, so the snapshot cannot change mid-write. */
  async function save(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!dirty) return;

    if (vectorsLoaded) {
      const live = new Set(documents.flatMap((d) => docChunks(d).map((c) => vectorKey(c.text))));
      for (const key of vectors.keys()) {
        if (!live.has(key)) {
          vectors.delete(key);
          vectorsDirty = true;
        }
      }
      if (vectorsDirty) await embedder.saveEmbeddings(vectors, indexPath);
      vectorsDirty = false;
    }

    dirty = false; // before the write: a change that lands while it runs (grounding, a sync) must stay dirty for the next save
    const docs = documents;
    const meta = await commitIndex(
      indexPath,
      generation,
      {
        model: embedder.getModel(),
        dimensions: embedder.getDimensions(),
        pooling: embedder.getPooling(),
        queryPrompt: embedder.getQueryPrompt(),
        totalChunks: docs.reduce((n, d) => n + docChunks(d).length, 0),
        ignoreGlobs: ignoreGlobsHash(parserKey()),
        bm25SelfTop: selfTop(),
      },
      async (stage) => {
        await Promise.all([
          graph.save(stage),
          vectorIndex?.save(stage),
          indexer.saveDocsCache(stage, docs),
          writeFile(join(stage, "manifest.json"), JSON.stringify(manifest)),
        ]);
      }
    ).catch((e) => { dirty = true; throw e; });
    if (meta) {
      generation = meta.generation;
      lastMetaMtime = await metaMtime(indexPath);
    } else {
      dirty = true;
      // another process holds the lock or committed first: retry later (the next sync adopts their commit and re-diffs)
      scheduleSave(5_000);
    }
  }

  /** Write any pending change now (reindex, tests). */
  const flushIndex = () => serial(save);

  let coldBuilding = false;
  function fullIndex(): Promise<void> {
    fullIndexing++;
    return serial(async () => {
      coldBuilding = documents.length === 0;
      indexState = "indexing";
      indexProgress = { embedded: 0, total: 0 };
      await embedder.init();
      await sync(true);
      // nothing was served before this, so ready waits for the code graph (grounding changes scores); warm swaps stay serve-then-stale (#73)
      if (coldBuilding) await lastCodeLoad;
      // a forced rebuild replaces whatever is on disk (unusable or stale), so it commits over the current generation
      generation = (await readMeta(indexPath))?.generation ?? 0;
      await save();
      indexState = "ready";
    }).finally(() => {
      coldBuilding = false;
      fullIndexing--;
    });
  }

  function backgroundIndex() {
    if (indexingPromise) return;
    indexingPromise = fullIndex()
      .catch((err) => {
        process.stderr.write(`Index error: ${err?.stack ?? err}\n`);
        if (indexState === "indexing") indexState = documents.length > 0 ? "stale" : "empty";
      })
      .finally(() => {
        indexingPromise = null;
      });
  }

  function runReconcile(): Promise<void> {
    if (!reconcileInFlight) {
      // an older index is replaced by a full rebuild, while the old one keeps answering (stale)
      const run = upgrading ? ((upgrading = false), fullIndex()) : serial(() => sync());
      reconcileInFlight = run
        .catch((err) => {
          process.stderr.write(`Reconcile error: ${err?.stack ?? err}\n`);
          if (indexState === "indexing") indexState = "stale";
        })
        .finally(() => {
          reconcileInFlight = null;
          lastReconcileAt = Date.now();
        });
    }
    return reconcileInFlight;
  }

  /** Called before every tool. Throttled; a call arriving mid-reconcile awaits it; the first one after a warm load does not wait. */
  async function ensureFresh(): Promise<void> {
    if (options.locked) return;
    if (indexState === "loading" || indexState === "empty" || fullIndexing > 0) return;
    if (reconcileInFlight) return stale ? undefined : reconcileInFlight;
    if (Date.now() - lastReconcileAt < throttleMs) return;
    const run = runReconcile();
    if (!stale) await run;
  }

  function textResponse(text: string) {
    return { content: [{ type: "text" as const, text }] };
  }

  function indexingMessage(): string {
    if (indexProgress.total > 0) {
      return `Indexing in progress (${indexProgress.embedded}/${indexProgress.total} chunks)... Try again shortly.`;
    }
    return "Indexing in progress... Try again shortly.";
  }

  function enrichResult<T extends { path: string }>(result: T): T & EnrichedResult {
    const doc = docByPath.get(result.path);
    if (!doc) return result;
    return {
      ...result,
      // the index results carry the path as their title
      ...(doc.title && { title: doc.title }),
      mtime: doc.mtime,
      ...(doc.loadPriority !== undefined && { loadPriority: doc.loadPriority }),
      ...(doc.status !== undefined && { status: doc.status }),
      ...(doc.tier !== undefined && { tier: doc.tier }),
      ...(doc.domains !== undefined && { domains: doc.domains }),
    };
  }

  function applyPriorityBoost(score: number, path: string): number {
    const doc = docByPath.get(path);
    if (doc?.loadPriority === undefined) return score;
    return score * (1 + (doc.loadPriority - 5) * 0.04);
  }

  // Decay config is read once from vault.schema.yml and cached for the process.
  let decayConfig: DecayConfig | null = null;
  function getDecayConfig(): DecayConfig {
    if (!decayConfig) decayConfig = loadDecayConfig(notesPath);
    return decayConfig;
  }

  function applyDecay<T extends { path: string; score: number }>(r: T): T & { decay?: DecayBlock; grounding?: ReturnType<typeof groundingBlock> } {
    const cfg = getDecayConfig();
    if (!cfg.enabled) return r;
    const doc = docByPath.get(r.path);
    if (!doc) return r;
    const { multiplier, block, grounding } = decayForDoc(doc, cfg);
    return { ...r, score: r.score * multiplier, ...(block && { decay: block }), ...(grounding && { grounding }) };
  }

  /** Everything that decides which files are indexed, skipped secret files included, so a changed list re-parses. */
  const parserKey = () => [...parserInputs(getPathClassConfig(), fields), ...(options.skipFiles ?? []).map((f) => `skip:${f}`)];

  let pathClassConfig: PathClassConfig | null = null;
  function getPathClassConfig(): PathClassConfig {
    if (!pathClassConfig) pathClassConfig = sourcePathClass(notesPath, rules);
    return pathClassConfig;
  }

  function applyPathClass<T extends { path: string; score: number }>(r: T): T {
    const m = pathClassMultiplier(r.path, getPathClassConfig());
    return m === 1 ? r : { ...r, score: r.score * m };
  }

  function filterPathClass<T extends { path: string; matchedChunk?: string }>(results: T[]): T[] {
    return filterPathClassBy(results, getPathClassConfig()).filter((r) => !docByPath.get(r.path)?.generated);
  }

  // Usage-feedback boost (v1.5). Config is process-cached; the citation snapshot
  // is refreshed from the selection log on a short TTL so within-session citations
  // eventually take effect without re-reading the log on every scored result.
  let usageBoostConfig: UsageBoostConfig | null = null;
  function getUsageBoostConfig(): UsageBoostConfig {
    if (!usageBoostConfig) usageBoostConfig = loadUsageBoostConfig(notesPath);
    return usageBoostConfig;
  }
  let citationCounts: Record<string, number> = {};
  let citationLoadedAtMs = 0;
  const CITATION_TTL_MS = 15_000;

  async function refreshUsageBoost(): Promise<void> {
    if (!getUsageBoostConfig().enabled) return;
    const now = Date.now();
    if (now - citationLoadedAtMs < CITATION_TTL_MS && citationLoadedAtMs > 0) return;
    try {
      citationCounts = await loadCitationCounts(notesPath);
      citationLoadedAtMs = now;
    } catch {
      /* keep the previous snapshot on error */
    }
  }

  function applyUsageBoost<T extends { path: string; score: number }>(r: T): T & { usage?: UsageBlock } {
    const cfg = getUsageBoostConfig();
    if (!cfg.enabled) return r;
    const citations = citationCounts[r.path] ?? 0;
    const m = computeUsageBoost(citations, cfg);
    if (m === 1) return r;
    return { ...r, score: r.score * m, usage: { citations, multiplier: Math.round(m * 1000) / 1000 } };
  }

  function applyDateFilter<T extends { path: string }>(
    results: T[],
    modifiedAfter?: string,
    modifiedBefore?: string
  ): T[] {
    if (!modifiedAfter && !modifiedBefore) return results;
    const after = modifiedAfter ? new Date(modifiedAfter).getTime() : -Infinity;
    const before = modifiedBefore ? new Date(modifiedBefore).getTime() : Infinity;
    return results.filter((r) => {
      const doc = docByPath.get(r.path);
      if (!doc) return true;
      const t = new Date(doc.mtime).getTime();
      return t >= after && t <= before;
    });
  }

  return {
    notesPath,
    indexPath,
    telemetryDir: options.readOnly ? indexPath : undefined,
    options,
    indexer,
    embedder,
    reranker,
    graph,
    textSearch,
    bm25,
    fields,
    ranking: loadRanking(notesPath),
    isExcluded: (p) => isExcludedPath(p, getPathClassConfig()),
    bm25Min: () => {
      const top = selfTop();
      return top === null ? null : top * BM25_FRACTION;
    },
    crud,
    frontmatterManager,
    tagManager,
    sessions,
    getDocuments: () => documents,
    getDocByPath: () => docByPath,
    searchablePaths: () => {
      if (searchablePathsFor !== docByPath) {
        searchablePathsFor = docByPath;
        searchablePathsStr = [...docByPath.values()].filter((d) => isSearchableDoc(d, getPathClassConfig())).map((d) => d.path).join("\n").toLowerCase();
      }
      return searchablePathsStr;
    },
    getCode: () => codeData,
    getCodeLoad: () => codeLoad,
    getVectorIndex: () => (coldBuilding ? null : vectorIndex), // a cold build answers "Indexing in progress" until its code graph has landed
    getIndexState: () => indexState,
    getIndexProgress: () => indexProgress,
    tryLoadCachedIndex,
    fullIndex,
    backgroundIndex,
    ensureFresh,
    invalidate: () => {
      lastReconcileAt = 0;
    },
    reconcileNow: runReconcile,
    isStale: () => stale || codePending > 0,
    flushIndex,
    isIndexingInFlight: () => indexingPromise !== null,
    textResponse,
    indexingMessage,
    enrichResult,
    applyPriorityBoost,
    applyDecay,
    applyPathClass,
    filterPathClass,
    applyUsageBoost,
    refreshUsageBoost,
    applyDateFilter,
  };
}

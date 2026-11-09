import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { applyCoverage } from "../../core/rank.js";
import { fuseScores } from "../../core/bm25.js";
import { missingTerms } from "../../core/identifiers.js";
import { entityCard, knownToCode, splitUndocumented } from "../../core/code-graph.js";
import { RERANK_TOP } from "../../core/reranker.js";
import { fold } from "../../core/fold.js";
import { classifyQuery, type QueryType } from "../../core/query-type.js";
import { readingPath } from "../../core/reading-path.js";
import { sectionFields } from "../../core/section-fields.js";
import { excerpt, isWeak, standaloneConfidence, withConfidence, NO_STRONG_MATCH_BELOW, RELATED_MIN_CONFIDENCE } from "../../core/confidence.js";
import type { SearchResult } from "../../core/types.js";
import { mergeSources, type SourceRun } from "../../core/federation-merge.js";
import { PRIMARY_LABEL, registryFor } from "../sources.js";
import { appendEvent, recordSearchForCorrelation } from "../../core/telemetry.js";

/**
 * Selection telemetry (v1.3.1): record what a semantic search returned and prime
 * the correlation ring so a subsequent read_note can be attributed to it. Awaited
 * so the log is durable before the result returns; appendEvent never throws and
 * respects the opt-out, so it can't fail the search.
 */
async function logSearch(ctx: ServerContext, tool: string, query: string, enriched: any[]): Promise<void> {
  if (ctx.options.telemetry === false) return;
  const results = enriched.map((r) => ({
    path: r.path,
    score: r.score,
    ...(r.decay ? { decay: r.decay.multiplier } : {}),
  }));
  const queryType: QueryType | undefined = enriched[0]?.query_type;
  recordSearchForCorrelation(ctx.notesPath, results.map((r) => r.path));
  await appendEvent(ctx.notesPath, { kind: "search", tool, query, results, ...(queryType && { query_type: queryType }) }, undefined, ctx.telemetryDir);
}

/** Context expansion: the #1 result's direct link neighbours that the search also found and that clear the confidence bar. */
function relatedTo(ctx: ServerContext, path: string, scored: (SearchResult & { confidence: number })[]) {
  const near = new Set([...ctx.graph.forwardlinks(path), ...ctx.graph.backlinks(path)].map((n) => n.path));
  return scored
    .filter((r) => r.path !== path && near.has(r.path) && standaloneConfidence(r) >= RELATED_MIN_CONFIDENCE)
    .slice(0, RELATED_MAX)
    .map((r) => ({ path: r.path, title: ctx.enrichResult(r).title, confidence: standaloneConfidence(r) }));
}

/**
 * Confidence on the whole ranked list, then the page. Default payload is trimmed to path/title/score/confidence
 * and a ~600-char excerpt around the match; `full` keeps the whole enriched result. A weak top result marks every
 * returned result `no_strong_match` (the response is an array, so the flag rides on its items).
 */
function shape(ctx: ServerContext, ranked: SearchResult[], query: string, limit: number, full: boolean, bm25Min: number | null, granularity: Granularity = "section", queryType?: QueryType, bestChunk?: (path: string) => string | undefined, allowed: (path: string) => boolean = () => true) {
  const scored = withConfidence(granularity === "section" ? fold(ranked, ctx.getDocByPath(), ctx.getCode()) : ranked);
  const page = scored.slice(0, limit);
  const absent = missingTerms(query, ctx.bm25, [...ctx.getDocByPath().keys()].join("\n").toLowerCase(), knownToCode(ctx.getCode()));
  const { missing, undocumented } = splitUndocumented(absent, ctx.getCode());
  const weak = isWeak(scored, bm25Min) || absent.length > 0;
  const scoreOf = new Map(scored.map((r) => [r.path, r.score]));
  const card = entityCard(query, ctx.getCode(), ctx.getDocByPath(), (p) => scoreOf.get(p) ?? -Infinity);
  // flow only, and attached to #1: the ranked list is never reordered. `dropped` = copies fold merged into their owner.
  const path = queryType === "flow" && bestChunk && page.length
    ? readingPath(ctx.graph, scored, ctx.getDocByPath(), { dropped: new Set(ranked.map((r) => r.path).filter((p) => !scoreOf.has(p))), minConfidence: NO_STRONG_MATCH_BELOW, skip: (p) => ctx.isExcluded(p) || !allowed(p), bestChunk })
    : [];
  return page.map((r, i) => {
    const { cosine: _c, lexical: _l, bm25: _b, ...e } = ctx.enrichResult(r);
    const sec = sectionFields(ctx.getDocByPath().get(r.path), e.matchedChunk ?? e.snippet, e.title);
    const out = full
      ? e
      : {
          path: e.path,
          title: e.title,
          score: e.score,
          confidence: e.confidence,
          snippet: excerpt(sec.text, query),
          ...(e.matched && { matched: e.matched }),
          ...((e as any).also_in && { also_in: (e as any).also_in }),
          ...(granularity === "section" && { ...(sec.section && { section: sec.section }), ...(sec.anchor && { anchor: sec.anchor }), ...(sec.code && { code: sec.code }) }),
          ...((e as any).decay && { decay: (e as any).decay }),
          ...((e as any).grounding && { grounding: (e as any).grounding }),
          ...((e as any).usage && { usage: (e as any).usage }),
        };
    if (full && granularity === "section") Object.assign(out, { ...(sec.section && { section: sec.section }), ...(sec.anchor && { anchor: sec.anchor }), ...(sec.code && { code: sec.code }) });
    const typed = i === 0 && queryType ? { ...out, query_type: queryType } : out;
    const withCard = i === 0 && (card || path.length) ? { ...typed, ...(card && { entity: card }), ...(path.length && { reading_path: path }) } : typed;
    if (weak) return { ...withCard, no_strong_match: true, ...(missing.length && { missing_terms: missing }), ...(undocumented.length && { undocumented }) };
    const related = i === 0 ? relatedTo(ctx, r.path, scored) : [];
    return related.length ? { ...withCard, related } : withCard;
  });
}

const GRAPH_SEARCH_SEEDS = 5;
const RELATED_MAX = 3;
const edgeTypes = z.array(z.enum(["link", "wikilink", "related", "cites", "same-incident", "supersedes", "tag"])).optional().describe("Edge types to follow (default link, wikilink, related, cites, same-incident)");
type Granularity = "section" | "doc";
const granularityArg = z.enum(["section", "doc"]).optional().default("section").describe("\"section\" (default) adds the best section's `section` trail, `anchor` and `code` refs to each result; \"doc\" returns whole-doc results without them");
const fullArg = z.boolean().optional().default(false).describe("Return the whole result (full matched chunk, frontmatter fields) instead of the trimmed default");

interface HybridArgs {
  query: string;
  limit: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
  status?: string;
  tier?: string;
  domain?: string;
  full: boolean;
  granularity: Granularity;
  queryType: QueryType;
}

/** One context's whole hybrid pipeline (both arms, boosts, coverage, filters, rerank) from a ready query embedding, up to the page: `ranked` before fold, `items` after. */
async function hybridRanked(ctx: ServerContext, vectorIndex: NonNullable<ReturnType<ServerContext["getVectorIndex"]>>, queryEmbed: Float32Array, a: HybridArgs) {
  const { query, limit, modifiedAfter, modifiedBefore, status, tier, domain } = a;
  await ctx.refreshUsageBoost();
  // Boosts act on each arm's own scores, before fusion.
  const adjust = (rs: SearchResult[]) =>
    rs
      .map((r) => ctx.applyUsageBoost(ctx.applyPathClass(ctx.applyDecay({ ...r, score: ctx.applyPriorityBoost(r.score, r.path) }))))
      .sort((a, b) => b.score - a.score);
  const semanticResults = adjust(vectorIndex.search(queryEmbed, limit * 3));
  let hybrid = applyCoverage(fuseScores(semanticResults, adjust(ctx.bm25.search(query, limit * 3))), query, ctx.bm25, ctx.graph, ctx.ranking, ctx.isExcluded);
  hybrid = ctx.filterPathClass(hybrid);

  hybrid = ctx.applyDateFilter(hybrid, modifiedAfter, modifiedBefore);
  const docByPath = ctx.getDocByPath();
  if (status) hybrid = hybrid.filter((r) => docByPath.get(r.path)?.status === status);
  if (tier) hybrid = hybrid.filter((r) => docByPath.get(r.path)?.tier === tier);
  if (domain) hybrid = hybrid.filter((r) => docByPath.get(r.path)?.domains?.includes(domain));

  if (ctx.reranker) hybrid = [...(await ctx.reranker.rerank(query, hybrid.slice(0, Math.max(RERANK_TOP, limit)))), ...hybrid.slice(Math.max(RERANK_TOP, limit))];
  // path members that were not hits must pass the same filters as the hits
  const allowed = (p: string) => {
    const d = docByPath.get(p);
    return (!status || d?.status === status) && (!tier || d?.tier === tier) && (!domain || !!d?.domains?.includes(domain)) && ctx.applyDateFilter([{ path: p }], modifiedAfter, modifiedBefore).length > 0;
  };
  return { hybrid, allowed };
}

async function hybridSearch(ctx: ServerContext, vectorIndex: NonNullable<ReturnType<ServerContext["getVectorIndex"]>>, queryEmbed: Float32Array, a: HybridArgs) {
  const { hybrid, allowed } = await hybridRanked(ctx, vectorIndex, queryEmbed, a);
  const items = shape(ctx, hybrid, a.query, a.limit, a.full, ctx.bm25Min(), a.granularity, a.queryType, (p) => vectorIndex.bestChunk(p, queryEmbed), allowed);
  return { ranked: hybrid, items };
}

/** Trailing text block (like the stale marker) for skipped or stale sources; content[0] stays the plain JSON array. */
function respond(res: { content: { type: "text"; text: string }[] }, notes: string[], stale = false) {
  return { content: notes.length ? [...res.content, { type: "text" as const, text: notes.join("\n") }] : res.content, ...(stale && { _meta: { stale: true } }) };
}

export function registerSearchTools(server: McpServer, ctx: ServerContext): void {
  const sources = registryFor(ctx);
  server.tool(
    "search_semantic",
    "Vector similarity search — find notes similar to a query by meaning. Scores are boosted by load_priority and down-weighted by confidence decay (time since last_verified); decayed results carry a `decay` block. Set decay.enabled:false in vault.schema.yml to disable. Results carry `confidence` (0-1) and a ~600-char excerpt; when the match is weak (low cosine and no strong lexical hit) every result has `no_strong_match: true`: a weak match, verify before citing it. A query naming an identifier (snake_case, camelCase, a path, a dotted name) that no indexed doc contains also sets it, with `missing_terms: [...]` (not in the docs or the code) or `undocumented: [{entity, path}]` (in the code, in no doc). A query naming a symbol or file the docs cite gets an `entity` card on result #1: its path (\"defined in\" or \"found in\") and the docs citing it. `full: true` returns whole chunks and frontmatter fields. Each result also carries its best section: `section` (heading trail), `anchor` (heading anchor, hewtd's rules) and `code` (up to 3 code refs in the section); `granularity: \"doc\"` leaves them out.",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date (e.g. '2026-01-01')"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status (e.g. 'active', 'draft')"),
      tier: z.string().optional().describe("Filter by frontmatter tier (e.g. 'guide', 'reference')"),
      domain: z.string().optional().describe("Filter by frontmatter domain (e.g. 'api', 'security')"),
      full: fullArg,
      granularity: granularityArg,
    },
    async ({ query, limit, modifiedAfter, modifiedBefore, status, tier, domain, full, granularity }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) {
        return ctx.textResponse(ctx.indexingMessage());
      }
      const queryEmbed = await ctx.embedder.embedQuery(query);
      await ctx.refreshUsageBoost();
      let results = vectorIndex.search(queryEmbed, limit * 3);
      results = results.map((r) => ctx.applyUsageBoost(ctx.applyPathClass(ctx.applyDecay({ ...r, score: ctx.applyPriorityBoost(r.score, r.path) }))));
      results.sort((a, b) => b.score - a.score);
      results = ctx.filterPathClass(results);
      results = ctx.applyDateFilter(results, modifiedAfter, modifiedBefore);
      const docByPath = ctx.getDocByPath();
      if (status) results = results.filter((r) => docByPath.get(r.path)?.status === status);
      if (tier) results = results.filter((r) => docByPath.get(r.path)?.tier === tier);
      if (domain) results = results.filter((r) => docByPath.get(r.path)?.domains?.includes(domain));
      const enriched = shape(ctx, results, query, limit, full, null, granularity); // no lexical arm here: the cosine alone decides
      await logSearch(ctx, "search_semantic", query, enriched);
      return ctx.textResponse(JSON.stringify(enriched, null, 2));
    }
  );

  server.tool(
    "search_text",
    "Full-text keyword or regex search across all notes with optional filters",
    {
      pattern: z.string(),
      regex: z.boolean().optional().default(false),
      caseSensitive: z.boolean().optional().default(false),
      pathGlob: z.string().optional(),
      tagFilter: z.array(z.string()).optional(),
      limit: z.coerce.number().optional().default(20),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status"),
      tier: z.string().optional().describe("Filter by frontmatter tier"),
      domain: z.string().optional().describe("Filter by frontmatter domain"),
    },
    async ({ modifiedAfter, modifiedBefore, status, tier, domain, ...opts }) => {
      const documents = ctx.getDocuments();
      if (documents.length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      let results = ctx.textSearch.search(opts);
      if (!opts.pathGlob) results = ctx.filterPathClass(results); // an explicit pathGlob can still reach the archive
      results = ctx.applyDateFilter(results, modifiedAfter, modifiedBefore);
      const docByPath = ctx.getDocByPath();
      if (status) results = results.filter((r) => docByPath.get(r.path)?.status === status);
      if (tier) results = results.filter((r) => docByPath.get(r.path)?.tier === tier);
      if (domain) results = results.filter((r) => docByPath.get(r.path)?.domains?.includes(domain));
      const enriched = results.map((r) => ctx.enrichResult(r));
      return ctx.textResponse(JSON.stringify(enriched, null, 2));
    }
  );

  server.tool(
    "search_graph",
    "Graph traversal — the notes closest to a concept by meaning (its top semantic hits), then the notes they link to or are linked from (links, wikilinks, related_docs, cited facts, same incident), nearest first. Hub files are skipped and there is no popularity tiebreak. Pass types to change the edges followed (e.g. add 'tag').",
    {
      concept: z.string(),
      maxDepth: z.coerce.number().optional().default(2),
      limit: z.coerce.number().optional().default(20),
      types: edgeTypes,
    },
    async ({ concept, maxDepth, limit, types }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) return ctx.textResponse(ctx.indexingMessage());
      const hits = ctx.filterPathClass(vectorIndex.search(await ctx.embedder.embedQuery(concept), GRAPH_SEARCH_SEEDS * 3)).slice(0, GRAPH_SEARCH_SEEDS);
      const walked = ctx.graph.searchGraph(hits.map((h) => h.path), maxDepth, types?.includes("supersedes") ? limit : Number.MAX_SAFE_INTEGER, types);
      const results = (types?.includes("supersedes") ? walked : ctx.filterPathClass(walked)).slice(0, limit);
      return ctx.textResponse(JSON.stringify(results, null, 2));
    }
  );

  const hybridTool = server.tool(
    "search_hybrid",
    "Combined semantic + lexical search — vector and BM25 scores fused per document (0.7 cosine + 0.3 scaled BM25), re-ranked by load_priority, and down-weighted by confidence decay (time since last_verified); decayed results carry a `decay` block. Results carry `confidence` (0-1) and a ~600-char excerpt; when the match is weak (low cosine and no strong lexical hit) every result has `no_strong_match: true`: a weak match, verify before citing it. A query naming an identifier (snake_case, camelCase, a path, a dotted name) that no indexed doc contains also sets it, with `missing_terms: [...]` (not in the docs or the code) or `undocumented: [{entity, path}]` (in the code, in no doc). A query naming a symbol or file the docs cite gets an `entity` card on result #1: its path (\"defined in\" or \"found in\") and the docs citing it. For a broad or end-to-end question (how does X work, overview of Y, several steps) read the excerpts of the top 3 results, not just #1, and search each step separately (how is it deployed, how is it verified, how is it rolled back). `full: true` returns whole chunks and frontmatter fields. Each result also carries its best section: `section` (heading trail), `anchor` (heading anchor, hewtd's rules) and `code` (up to 3 code refs in the section); `granularity: \"doc\"` leaves them out. With `federation.sources` configured, one search covers this vault and every source; when two or more answer, each result carries `source` (pass it to read_note) and skipped or stale sources are named in a trailing text block.",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status"),
      tier: z.string().optional().describe("Filter by frontmatter tier"),
      domain: z.string().optional().describe("Filter by frontmatter domain"),
      full: fullArg,
      granularity: granularityArg,
      mode: z.enum(["auto", "identifier", "fact", "flow"]).optional().default("auto").describe("Query type: auto classifies the query; the other values override it. Reported as query_type on result #1; ranking is the same."),
    },
    async ({ query, limit, modifiedAfter, modifiedBefore, status, tier, domain, full, granularity, mode }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) {
        return ctx.textResponse(ctx.indexingMessage());
      }

      const queryEmbed = await ctx.embedder.embedQuery(query);
      const args: HybridArgs = { query, limit, modifiedAfter, modifiedBefore, status, tier, domain, full, granularity, queryType: mode === "auto" ? classifyQuery(query, knownToCode(ctx.getCode())) : mode };
      const { ready, notes } = await sources.open();
      if (ready.length === 0) {
        const { items } = (await hybridSearch(ctx, vectorIndex, queryEmbed, args))!;
        await logSearch(ctx, "search_hybrid", query, items);
        return respond(ctx.textResponse(JSON.stringify(items, null, 2)), notes);
      }

      // Federated: one query embedding, each source ranked by its own pipeline, then merged. A source that is not ready
      // is skipped (reported in `notes`), so the primary alone answers exactly as it does without federation.
      await Promise.all(ready.map((h) => h.ctx.ensureFresh()));
      const runs: SourceRun[] = [{ label: PRIMARY_LABEL, weight: 1, bm25Min: ctx.bm25Min(), ...(await hybridSearch(ctx, vectorIndex, queryEmbed, args))! }];
      for (const h of ready) {
        const vi = h.ctx.getVectorIndex();
        const run = vi && (await hybridSearch(h.ctx, vi, queryEmbed, args));
        if (run) runs.push({ label: h.label, weight: h.weight, bm25Min: h.ctx.bm25Min(), ...run });
      }
      const items = mergeSources(runs, limit);
      const staleNotes = ready.filter((h) => h.ctx.isStale()).map((h) => `[federation: source "${h.label}" is stale, an older index is answering while it refreshes]`);
      await logSearch(ctx, "search_hybrid", query, items.map((r) => (r.source && r.source !== PRIMARY_LABEL ? { ...r, path: `${r.source}:${r.path}` } : r)));
      return respond(ctx.textResponse(JSON.stringify(items, null, 2)), [...notes, ...staleNotes], staleNotes.length > 0);
    }
  );
  // the one tool kept out of Claude Code's tool search, so a session can call it without looking it up first (v1.7.2)
  hybridTool.update({ _meta: { "anthropic/alwaysLoad": true } });
}

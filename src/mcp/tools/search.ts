import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { applyCoverage } from "../../core/rank.js";
import { fuseScores } from "../../core/bm25.js";
import { missingTerms } from "../../core/identifiers.js";
import { RERANK_TOP } from "../../core/reranker.js";
import { excerpt, isWeak, standaloneConfidence, withConfidence, RELATED_MIN_CONFIDENCE } from "../../core/confidence.js";
import type { SearchResult } from "../../core/types.js";
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
  recordSearchForCorrelation(ctx.notesPath, results.map((r) => r.path));
  await appendEvent(ctx.notesPath, { kind: "search", tool, query, results }, undefined, ctx.telemetryDir);
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
function shape(ctx: ServerContext, ranked: SearchResult[], query: string, limit: number, full: boolean, bm25Min: number | null) {
  const scored = withConfidence(ranked);
  const page = scored.slice(0, limit);
  const missing = missingTerms(query, ctx.bm25, [...ctx.getDocByPath().keys()].join("\n").toLowerCase());
  const weak = isWeak(scored, bm25Min) || missing.length > 0;
  return page.map((r, i) => {
    const { cosine: _c, lexical: _l, bm25: _b, ...e } = ctx.enrichResult(r);
    const out = full
      ? e
      : {
          path: e.path,
          title: e.title,
          score: e.score,
          confidence: e.confidence,
          snippet: excerpt(e.matchedChunk ?? e.snippet, query),
          ...(e.matched && { matched: e.matched }),
          ...((e as any).decay && { decay: (e as any).decay }),
          ...((e as any).grounding && { grounding: (e as any).grounding }),
          ...((e as any).usage && { usage: (e as any).usage }),
        };
    if (weak) return { ...out, no_strong_match: true, ...(missing.length && { missing_terms: missing }) };
    const related = i === 0 ? relatedTo(ctx, r.path, scored) : [];
    return related.length ? { ...out, related } : out;
  });
}

const GRAPH_SEARCH_SEEDS = 5;
const RELATED_MAX = 3;
const edgeTypes = z.array(z.enum(["link", "wikilink", "related", "cites", "same-incident", "supersedes", "tag"])).optional().describe("Edge types to follow (default link, wikilink, related, cites, same-incident)");
const fullArg = z.boolean().optional().default(false).describe("Return the whole result (full matched chunk, frontmatter fields) instead of the trimmed default");

export function registerSearchTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "search_semantic",
    "Vector similarity search — find notes similar to a query by meaning. Scores are boosted by load_priority and down-weighted by confidence decay (time since last_verified); decayed results carry a `decay` block. Set decay.enabled:false in vault.schema.yml to disable. Results carry `confidence` (0-1) and a ~600-char excerpt; when the match is weak (low cosine and no strong lexical hit) every result has `no_strong_match: true`: a weak match, verify before citing it. A query naming an identifier (snake_case, camelCase, a path, a dotted name) that no indexed doc contains also sets it, with `missing_terms: [...]`: those names are not in the docs (they may still exist in code). `full: true` returns whole chunks and frontmatter fields.",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date (e.g. '2026-01-01')"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status (e.g. 'active', 'draft')"),
      tier: z.string().optional().describe("Filter by frontmatter tier (e.g. 'guide', 'reference')"),
      domain: z.string().optional().describe("Filter by frontmatter domain (e.g. 'api', 'security')"),
      full: fullArg,
    },
    async ({ query, limit, modifiedAfter, modifiedBefore, status, tier, domain, full }) => {
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
      const enriched = shape(ctx, results, query, limit, full, null); // no lexical arm here: the cosine alone decides
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
    "Combined semantic + lexical search — vector and BM25 scores fused per document (0.7 cosine + 0.3 scaled BM25), re-ranked by load_priority, and down-weighted by confidence decay (time since last_verified); decayed results carry a `decay` block. Results carry `confidence` (0-1) and a ~600-char excerpt; when the match is weak (low cosine and no strong lexical hit) every result has `no_strong_match: true`: a weak match, verify before citing it. A query naming an identifier (snake_case, camelCase, a path, a dotted name) that no indexed doc contains also sets it, with `missing_terms: [...]`: those names are not in the docs (they may still exist in code). For a broad or end-to-end question (how does X work, overview of Y, several steps) read the excerpts of the top 3 results, not just #1, and search each step separately (how is it deployed, how is it verified, how is it rolled back). `full: true` returns whole chunks and frontmatter fields.",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status"),
      tier: z.string().optional().describe("Filter by frontmatter tier"),
      domain: z.string().optional().describe("Filter by frontmatter domain"),
      full: fullArg,
    },
    async ({ query, limit, modifiedAfter, modifiedBefore, status, tier, domain, full }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) {
        return ctx.textResponse(ctx.indexingMessage());
      }

      const queryEmbed = await ctx.embedder.embedQuery(query);
      await ctx.refreshUsageBoost();
      // Boosts act on each arm's own scores, before fusion, so a x1.3 stays a x1.3 on the cosine.
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
      const enriched = shape(ctx, hybrid, query, limit, full, ctx.bm25Min());
      await logSearch(ctx, "search_hybrid", query, enriched);
      return ctx.textResponse(JSON.stringify(enriched, null, 2));
    }
  );
  // the one tool kept out of Claude Code's tool search, so a session can call it without looking it up first (v1.7.2)
  hybridTool.update({ _meta: { "anthropic/alwaysLoad": true } });
}

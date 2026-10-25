import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { appendEvent, recordSearchForCorrelation } from "../../core/telemetry.js";

/**
 * Selection telemetry (v1.3.1): record what a semantic search returned and prime
 * the correlation ring so a subsequent read_note can be attributed to it. Awaited
 * so the log is durable before the result returns; appendEvent never throws and
 * respects the opt-out, so it can't fail the search.
 */
async function logSearch(ctx: ServerContext, tool: string, query: string, enriched: any[]): Promise<void> {
  const results = enriched.map((r) => ({
    path: r.path,
    score: r.score,
    ...(r.decay ? { decay: r.decay.multiplier } : {}),
  }));
  recordSearchForCorrelation(ctx.notesPath, results.map((r) => r.path));
  await appendEvent(ctx.notesPath, { kind: "search", tool, query, results });
}

export function registerSearchTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "search_semantic",
    "Vector similarity search — find notes similar to a query by meaning. Scores are boosted by load_priority and down-weighted by confidence decay (time since last_verified); decayed results carry a `decay` block. Set decay.enabled:false in vault.schema.yml to disable.",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date (e.g. '2026-01-01')"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status (e.g. 'active', 'draft')"),
      tier: z.string().optional().describe("Filter by frontmatter tier (e.g. 'guide', 'reference')"),
      domain: z.string().optional().describe("Filter by frontmatter domain (e.g. 'api', 'security')"),
    },
    async ({ query, limit, modifiedAfter, modifiedBefore, status, tier, domain }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) {
        return ctx.textResponse(ctx.indexingMessage());
      }
      const queryEmbed = await ctx.embedder.embed(query);
      await ctx.refreshUsageBoost();
      let results = vectorIndex.search(queryEmbed, limit * 3);
      results = results.map((r) => ctx.applyUsageBoost(ctx.applyPathClass(ctx.applyDecay({ ...r, score: ctx.applyPriorityBoost(r.score, r.path) }))));
      results.sort((a, b) => b.score - a.score);
      results = ctx.applyDateFilter(results, modifiedAfter, modifiedBefore);
      const docByPath = ctx.getDocByPath();
      if (status) results = results.filter((r) => docByPath.get(r.path)?.status === status);
      if (tier) results = results.filter((r) => docByPath.get(r.path)?.tier === tier);
      if (domain) results = results.filter((r) => docByPath.get(r.path)?.domains?.includes(domain));
      const enriched = results.slice(0, limit).map((r) => ctx.enrichResult(r));
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
    "Graph traversal — find notes connected to a concept via wikilinks, related_docs, and specific tags. Results ranked by directness, load_priority, and degree.",
    {
      concept: z.string(),
      maxDepth: z.coerce.number().optional().default(2),
      limit: z.coerce.number().optional().default(20),
    },
    async ({ concept, maxDepth, limit }) => {
      const documents = ctx.getDocuments();
      if (documents.length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      const results = ctx.graph.searchGraph(concept, maxDepth, limit);
      return ctx.textResponse(JSON.stringify(results, null, 2));
    }
  );

  server.tool(
    "search_hybrid",
    "Combined semantic + graph search — vector results re-ranked by graph proximity and load_priority, and down-weighted by confidence decay (time since last_verified); decayed results carry a `decay` block.",
    {
      query: z.string(),
      limit: z.coerce.number().optional().default(10),
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status"),
      tier: z.string().optional().describe("Filter by frontmatter tier"),
      domain: z.string().optional().describe("Filter by frontmatter domain"),
    },
    async ({ query, limit, modifiedAfter, modifiedBefore, status, tier, domain }) => {
      const vectorIndex = ctx.getVectorIndex();
      if (!vectorIndex) {
        return ctx.textResponse(ctx.indexingMessage());
      }

      const queryEmbed = await ctx.embedder.embed(query);
      await ctx.refreshUsageBoost();
      const semanticResults = vectorIndex.search(queryEmbed, limit * 3);
      const graphResults = ctx.graph.searchGraph(query, 2);
      const graphPaths = new Set(graphResults.map((r) => r.path));

      let hybrid = semanticResults.map((r) =>
        ctx.applyUsageBoost(
          ctx.applyPathClass(
            ctx.applyDecay({
              ...r,
              score: ctx.applyPriorityBoost(graphPaths.has(r.path) ? r.score * 1.3 : r.score, r.path),
            })
          )
        )
      );
      hybrid.sort((a, b) => b.score - a.score);

      hybrid = ctx.applyDateFilter(hybrid, modifiedAfter, modifiedBefore);
      const docByPath = ctx.getDocByPath();
      if (status) hybrid = hybrid.filter((r) => docByPath.get(r.path)?.status === status);
      if (tier) hybrid = hybrid.filter((r) => docByPath.get(r.path)?.tier === tier);
      if (domain) hybrid = hybrid.filter((r) => docByPath.get(r.path)?.domains?.includes(domain));

      const enriched = hybrid.slice(0, limit).map((r) => ctx.enrichResult(r));
      await logSearch(ctx, "search_hybrid", query, enriched);
      return ctx.textResponse(JSON.stringify(enriched, null, 2));
    }
  );
}

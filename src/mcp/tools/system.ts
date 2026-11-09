import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../context.js";
import type { VaultStats } from "../../core/types.js";
import { fieldCoverage } from "../../core/fields.js";
import { docChunks } from "../../core/vector.js";
import { renderHelp } from "../../core/help/topics.js";
import { z } from "zod";

export function registerSystemTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "get_stats",
    "Vault and index statistics — note count, chunks, embeddings, graph density, and fieldCoverage: the share of searchable notes carrying each indexed frontmatter field",
    {},
    async () => {
      const documents = ctx.getDocuments();
      const vectorIndex = ctx.getVectorIndex();
      const indexState = ctx.getIndexState();
      const indexProgress = ctx.getIndexProgress();
      const graphStats = documents.length > 0 ? ctx.graph.statistics() : { totalNodes: 0, totalEdges: 0 };
      const stats: VaultStats = {
        totalNotes: documents.length,
        totalChunks: documents.reduce((n, d) => n + docChunks(d).length, 0),
        fieldCoverage: fieldCoverage(documents, ctx.fields),
        totalEmbeddings: vectorIndex?.getChunkMeta().length ?? 0,
        embeddingDimensions: ctx.embedder.getDimensions(),
        embeddingModel: ctx.embedder.getModel(),
        embeddingRuntime: ctx.embedder.getRuntime?.() ?? "unknown",
        graphNodes: graphStats.totalNodes,
        graphEdges: graphStats.totalEdges,
        indexSize: 0,
        lastIndexed: indexState === "ready" ? new Date().toISOString() : null,
        ...(ctx.isStale() && { stale: true }),
        ...(ctx.getCodeLoad() && { codeGraph: ctx.getCodeLoad() }),
        indexState,
        indexProgress: indexState === "indexing" ? indexProgress : undefined,
      };
      return ctx.textResponse(JSON.stringify(stats, null, 2));
    }
  );

  server.tool(
    "reindex",
    "Force a full reindex of the vault",
    {},
    async () => {
      if (ctx.isIndexingInFlight()) return ctx.textResponse("Reindex already in progress. " + ctx.indexingMessage());
      await ctx.fullIndex();
      const documents = ctx.getDocuments();
      return ctx.textResponse(
        `Reindexed: ${documents.length} notes, ${documents.reduce((n, d) => n + docChunks(d).length, 0)} chunks`
      );
    }
  );

  server.tool(
    "help",
    "How to use semantic-memory, in task terms. No topic lists the topics; a topic id or a few words (e.g. \"federated search\") returns the steps, commands and a check.",
    { topic: z.string().optional().describe("Topic id or words; omit to list topics") },
    async ({ topic }) => ctx.textResponse(renderHelp(topic, "markdown"))
  );
}

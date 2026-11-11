import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { appendEvent, wasRecentlySearched } from "../../core/telemetry.js";
import { extractSection } from "../../core/section.js";
import { PRIMARY_LABEL, registryFor } from "../sources.js";

export function registerReadTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "read_note",
    "Read a note by path. Pass `source` (the label a federated search result carries) to read from that source instead of this vault. Pass `section` (a heading name, or `#anchor` as search results give it) to read only that heading's section instead of the whole file — cheaper when you only need one part (e.g. a dossier's 'Knobs' section).",
    { path: z.string(), source: z.string().optional().describe("Source label from a federated search result; omit for this vault."), section: z.string().optional().describe("Heading name or #anchor — return only that section (heading through the next same-or-higher heading).") },
    async ({ path, source, section }) => {
      let crud = ctx.crud;
      if (source === "long-term") return ctx.textResponse(`"long-term" is a search target, not one folder. Read with the label a long-term hit carries (cold-<date>).`);
      if (source && source !== PRIMARY_LABEL) {
        const reg = registryFor(ctx);
        const hit = (await reg.open()).ready.find((h) => h.label === source) ?? (await reg.openOptIn([source])).ready[0];
        if (!hit) return ctx.textResponse(`Unknown or unavailable source "${source}". Use the label a search result carries.`);
        // a file the rotation's secrets scan flagged is never served, even though it is on disk
        if (hit.secrets?.includes(normalize(path))) return ctx.textResponse(`"${path}" in source "${source}" was flagged by a secrets scan and is not served.`);
        if (hit.locked) { // a link inside a frozen tree must not reach a flagged file or a file outside the tree
          try {
            const root = realpathSync(hit.path);
            const real = relative(root, realpathSync(join(root, path)));
            if (real.startsWith("..") || isAbsolute(real) || hit.secrets?.includes(real.split(sep).join("/"))) return ctx.textResponse(`"${path}" in source "${source}" is not served.`);
          } catch { /* a missing file falls through to crud.read's own error */ }
        }
        crud = hit.ctx.crud;
      }
      const content = await crud.read(path);
      // Selection telemetry (v1.3.1): reading a note is a "this got used" signal —
      // the valuable, low-frequency half of the log. Awaited so it's durably
      // recorded before we return; appendEvent never throws and respects the opt-out,
      // so it can add tiny latency but can never fail the read.
      const notePath = source && source !== PRIMARY_LABEL ? `${source}:${path}` : path; // as search_hybrid logs a source's hits
      if (ctx.options.telemetry !== false) await appendEvent(ctx.notesPath, {
        kind: "selection",
        note_path: notePath,
        via: "read_note",
        correlated: wasRecentlySearched(ctx.notesPath, notePath),
      }, undefined, ctx.telemetryDir);
      if (section) {
        const extracted = extractSection(content, section);
        return ctx.textResponse(extracted ?? `Section "${section}" not found in ${path}. Read without \`section\` for the full note.`);
      }
      return ctx.textResponse(content);
    }
  );

  server.tool(
    "read_multiple_notes",
    "[DEPRECATED — removed in v2.0.0; use read_note in a loop or via batched MCP calls] Batch read multiple notes in one call",
    { paths: z.array(z.string()) },
    async ({ paths }) => {
      const results = await ctx.crud.readMultiple(paths);
      const output: Record<string, string> = {};
      for (const [k, v] of results) output[k] = v;
      return ctx.textResponse(JSON.stringify(output, null, 2));
    }
  );

  server.tool(
    "list_notes",
    "List all indexed notes with metadata (title, tags, timestamps, link count). Supports filtering by date, status, tier, and domain.",
    {
      modifiedAfter: z.string().optional().describe("ISO date — only return notes modified after this date (e.g. '2026-01-01')"),
      modifiedBefore: z.string().optional().describe("ISO date — only return notes modified before this date"),
      status: z.string().optional().describe("Filter by frontmatter status (e.g. 'active', 'deprecated')"),
      tier: z.string().optional().describe("Filter by frontmatter tier (e.g. 'guide', 'reference')"),
      domain: z.string().optional().describe("Filter by frontmatter domain (e.g. 'api', 'security')"),
    },
    async ({ modifiedAfter, modifiedBefore, status, tier, domain }) => {
      const documents = ctx.getDocuments();
      if (documents.length === 0 && ctx.getIndexState() !== "ready") return ctx.textResponse(ctx.indexingMessage());
      const after = modifiedAfter ? new Date(modifiedAfter).getTime() : -Infinity;
      const before = modifiedBefore ? new Date(modifiedBefore).getTime() : Infinity;

      const list = documents
        .filter((d) => {
          const t = new Date(d.mtime).getTime();
          if (t < after || t > before) return false;
          if (status && d.status !== status) return false;
          if (tier && d.tier !== tier) return false;
          if (domain && !d.domains?.includes(domain)) return false;
          return true;
        })
        .map((d) => ({
          path: d.path,
          title: d.title,
          mtime: d.mtime,
          tags: d.tags,
          wikilinks: d.wikilinks.length,
          chunks: d.chunks.length,
          ...(d.loadPriority !== undefined && { loadPriority: d.loadPriority }),
          ...(d.status !== undefined && { status: d.status }),
          ...(d.tier !== undefined && { tier: d.tier }),
          ...(d.domains !== undefined && { domains: d.domains }),
          ...(d.purpose !== undefined && { purpose: d.purpose }),
        }));

      return ctx.textResponse(JSON.stringify(list, null, 2));
    }
  );
}

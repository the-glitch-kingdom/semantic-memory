import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { redactedNote } from "../../core/redact.js";

export function registerMetadataTools(server: McpServer, ctx: ServerContext): void {
  server.tool(
    "get_frontmatter",
    "Read parsed YAML frontmatter from a note as JSON",
    { path: z.string() },
    async ({ path }) => {
      const fm = await ctx.frontmatterManager.get(path);
      return ctx.textResponse(JSON.stringify(fm, null, 2));
    }
  );

  if (ctx.options.readOnly) return;

  server.tool(
    "update_frontmatter",
    "Set or delete YAML frontmatter keys — pass null to delete a key",
    { path: z.string(), fields: z.record(z.unknown()) },
    async ({ path, fields }) => {
      const { redacted } = await ctx.frontmatterManager.update(path, fields);
      return ctx.textResponse(`Frontmatter updated: ${path}${redactedNote(redacted)}`);
    }
  );

  server.tool(
    "manage_tags",
    "Add, remove, list, or rename tags on a note (frontmatter and inline). Use action='rename' with `from` and `to` to rename a tag vault-wide; `path` is ignored in that mode.",
    {
      path: z.string(),
      action: z.enum(["add", "remove", "list", "rename"]),
      tags: z.array(z.string()).optional(),
      from: z.string().optional().describe("For action='rename': the existing tag name (no leading #)"),
      to: z.string().optional().describe("For action='rename': the new tag name (no leading #)"),
    },
    async ({ path, action, tags, from, to }) => {
      switch (action) {
        case "list": {
          const result = await ctx.tagManager.list(path);
          return ctx.textResponse(JSON.stringify(result));
        }
        case "add": {
          if (!tags?.length) return ctx.textResponse("No tags provided");
          await ctx.tagManager.add(path, tags);
          return ctx.textResponse(`Added tags to ${path}: ${tags.join(", ")}`);
        }
        case "remove": {
          if (!tags?.length) return ctx.textResponse("No tags provided");
          await ctx.tagManager.remove(path, tags);
          return ctx.textResponse(`Removed tags from ${path}: ${tags.join(", ")}`);
        }
        case "rename": {
          if (!from || !to) return ctx.textResponse("action='rename' requires both `from` and `to`");
          const count = await ctx.tagManager.renameVaultWide(from, to);
          return ctx.textResponse(`Renamed #${from} → #${to} in ${count} files`);
        }
      }
    }
  );

  server.tool(
    "rename_tag",
    "[DEPRECATED — removed in v2.0.0; use manage_tags({action:'rename', from, to})] Rename a tag across all notes in the vault",
    { oldTag: z.string(), newTag: z.string() },
    async ({ oldTag, newTag }) => {
      const count = await ctx.tagManager.renameVaultWide(oldTag, newTag);
      return ctx.textResponse(`Renamed #${oldTag} → #${newTag} in ${count} files`);
    }
  );
}

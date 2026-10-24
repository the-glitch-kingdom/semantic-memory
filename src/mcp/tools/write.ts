import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerContext } from "../context.js";
import { redactedNote } from "../../core/redact.js";

export function registerWriteTools(server: McpServer, ctx: ServerContext): void {
  if (ctx.options.readOnly) return;

  server.tool(
    "create_note",
    "Create a new markdown note",
    {
      path: z.string(),
      content: z.string(),
      frontmatter: z.record(z.unknown()).optional(),
    },
    async ({ path, content, frontmatter }) => {
      const { redacted } = await ctx.crud.create(path, content, frontmatter);
      return ctx.textResponse(`Created: ${path}${redactedNote(redacted)}`);
    }
  );

  server.tool(
    "update_note",
    "Edit note content — overwrite, append, prepend, or patch by heading",
    {
      path: z.string(),
      content: z.string(),
      mode: z.enum(["overwrite", "append", "prepend", "patch-by-heading"]),
      heading: z.string().optional(),
    },
    async ({ path, content, mode, heading }) => {
      const { redacted } = await ctx.crud.update(path, content, { mode, heading });
      return ctx.textResponse(`Updated: ${path} (${mode})${redactedNote(redacted)}`);
    }
  );

  server.tool(
    "delete_note",
    "Delete a note permanently",
    { path: z.string(), confirm: z.boolean().default(false) },
    async ({ path, confirm }) => {
      if (!confirm) return ctx.textResponse(`Set confirm=true to delete ${path}`);
      await ctx.crud.delete(path);
      return ctx.textResponse(`Deleted: ${path}`);
    }
  );

  server.tool(
    "move_note",
    "Move or rename a note — updates wikilinks across the vault",
    { from: z.string(), to: z.string() },
    async ({ from, to }) => {
      await ctx.crud.move(from, to);
      return ctx.textResponse(`Moved: ${from} → ${to}`);
    }
  );
}

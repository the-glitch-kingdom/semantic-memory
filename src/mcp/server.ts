import { relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildContext, type ServerOptions } from "./context.js";
import { registerSearchTools } from "./tools/search.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerPatchTools } from "./tools/patch.js";
import { registerLintTools } from "./tools/lint.js";
import { registerLogTools } from "./tools/log.js";
import { registerMetadataTools } from "./tools/metadata.js";
import { registerGraphTools } from "./tools/graph.js";
import { registerSystemTools } from "./tools/system.js";
import { registerContractTools } from "./tools/contract.js";
import { registerSessionTools } from "./tools/session.js";
import { useMinimalToolSurface } from "../core/tools-config.js";

export type { ServerOptions } from "./context.js";

const STALE_NOTE = "[stale: an older index is answering while it refreshes, so section, anchor, grounding and the entity card may be missing; re-run the search to confirm]";

export async function createServer(notesPath: string, options: ServerOptions = {}) {
  const ctx = await buildContext(notesPath, options);

  const server = new McpServer(
    {
      name: "semantic-memory",
      version: "1.0.0",
    },
    { instructions: serverInstructions(notesPath, options.readOnly) }
  );

  // Pull-based freshness: every tool first reconciles the index with the tree (throttled), and
  // answers served from a warm cache that the first reconcile has not yet checked carry _meta.stale.
  // A tool that writes notes lifts the throttle so the next search sees the write at once.
  const registerTool = server.tool.bind(server) as (...args: any[]) => unknown;
  let writesNotes = false;
  (server as any).tool = (...args: any[]) => {
    const handler = args[args.length - 1];
    const mutates = writesNotes;
    args[args.length - 1] = async (...a: unknown[]) => {
      await ctx.ensureFresh();
      const res = await handler(...a);
      if (mutates) ctx.invalidate();
      if (!ctx.isStale() || !res || typeof res !== "object") return res;
      // _meta is not shown to the model in Claude Code, so a search also says it in the text it reads. A separate
      // trailing block keeps content[0] the plain JSON that programmatic clients parse.
      const content = (res as any).content;
      const marked = String(args[0]).startsWith("search_") && Array.isArray(content) ? [...content, { type: "text", text: STALE_NOTE }] : content;
      return { ...res, content: marked, _meta: { ...(res as any)._meta, stale: true } };
    };
    return registerTool(...args);
  };

  // Conditional tool registration (v1.4 Phase 7, DEFAULT OFF). When enabled via
  // tools.conditional AND the active mode is outage-silence, register only the
  // core read/search surface. Default → full surface (unchanged).
  const minimal = useMinimalToolSurface(notesPath);

  const registerWriting = (register: (s: McpServer, c: typeof ctx) => void) => {
    writesNotes = true;
    register(server, ctx);
    writesNotes = false;
  };

  registerSearchTools(server, ctx);
  registerReadTools(server, ctx);
  registerSystemTools(server, ctx);
  if (!minimal) {
    registerWriting(registerWriteTools);
    registerWriting(registerPatchTools);
    registerLintTools(server, ctx);
    registerWriting(registerLogTools);
    registerWriting(registerMetadataTools);
    registerGraphTools(server, ctx);
    registerWriting(registerContractTools);
    registerWriting(registerSessionTools);
  }

  if (options.waitForReady) {
    const cached = await ctx.tryLoadCachedIndex();
    if (!cached || options.forceReindex) await ctx.fullIndex();
    else await ctx.reconcileNow();
  } else {
    ctx.tryLoadCachedIndex()
      .then((cached) => (cached ? ctx.reconcileNow() : ctx.backgroundIndex()))
      .catch((err) => {
        process.stderr.write(`Startup error: ${err?.message ?? err}\n`);
        ctx.backgroundIndex();
      });
  }

  // startServer flushes a pending debounced save on the way out
  return Object.assign(server, { flushIndex: () => ctx.flushIndex() });
}

// Claude Code loads server instructions at session start even while the tools are deferred (v1.7.2)
export function serverInstructions(notesPath: string, readOnly = false): string {
  const where = relative(process.cwd(), notesPath) || notesPath;
  return (
    `This server indexes ${where} (markdown${readOnly ? ", read-only" : ""}) for semantic search. ` +
    `For a question about what ${where} says, call search_hybrid here before grepping or opening files there, ` +
    `then read_note the hits; search_text finds exact strings. ` +
    `For a broad or end-to-end question (how does X work, overview of Y, several steps), read the top 3 results, not just #1, and search each step separately. ` +
    `If the results carry no_strong_match: true, it is a weak match: verify the notes answer the question before citing them, and say so if they do not. missing_terms lists identifiers from the query that are in neither the docs nor the code; undocumented lists those that exist in code but in no doc. A query naming a symbol or file the docs cite gets an entity card on result #1 (where it is, which docs cite it).` +
    (readOnly ? "" : " Write research, decisions and gotchas here with synthesize_note.")
  );
}

export async function startServer(notesPath: string, options: ServerOptions = {}) {
  const server = await createServer(notesPath, options);
  const transport = new StdioServerTransport();

  // Exit when the parent process closes its end of the stdio pipe.
  //
  // This covers every "parent death" scenario: SIGKILL to Claude Code, OOM-kill,
  // session end, terminal close, remote-MCP network drop. When the parent dies
  // its end of the pipe is closed by the kernel, and the child receives EOF on
  // process.stdin (emits 'end' then 'close').
  //
  // Without these handlers the ONNX InferenceSession native thread-pool keeps the Node.js event loop alive
  // indefinitely — producing one orphan process (~180–200 MB RSS each) per Claude
  // session. On low-memory boxes this accumulates until RAM + swap are exhausted
  // and the host freezes.
  //
  // StdioServerTransport (MCP SDK v1.29.0) only listens for 'data' and 'error'
  // on stdin; it does not call process.exit() on EOF. The McpServer class also
  // does not exit the process on transport close — both are correct library
  // behaviour. It is the application's responsibility to exit, and this is it.
  // A reconcile's save is debounced 2 s: flush it first (bounded) so the next start does not redo the work.
  const quit = () =>
    void Promise.race([server.flushIndex().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]).finally(() => process.exit(0));
  process.stdin.once("end", quit);
  process.stdin.once("close", quit);

  // Honor explicit termination signals sent by process managers or the kernel.
  // SIGTERM: sent by systemd, launchd, Docker, or `kill <pid>`.
  // SIGHUP:  sent when the controlling terminal closes (e.g. SSH disconnect).
  // SIGINT (Ctrl-C) is already handled by Node.js default behaviour.
  process.once("SIGTERM", quit);
  process.once("SIGHUP", quit);

  await server.connect(transport);
}

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
      return ctx.isStale() && res && typeof res === "object" ? { ...res, _meta: { ...res._meta, stale: true } } : res;
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

  return server;
}

// Claude Code loads server instructions at session start even while the tools are deferred (v1.7.2)
export function serverInstructions(notesPath: string, readOnly = false): string {
  const where = relative(process.cwd(), notesPath) || notesPath;
  return (
    `This server indexes ${where} (markdown${readOnly ? ", read-only" : ""}) for semantic search. ` +
    `For a question about what ${where} says, call search_hybrid here before grepping or opening files there, ` +
    `then read_note the hits; search_text finds exact strings. ` +
    `If the results carry no_strong_match: true, the vault does not document it: say "not documented" instead of answering from them.` +
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
  process.stdin.once("end", () => process.exit(0));
  process.stdin.once("close", () => process.exit(0));

  // Honor explicit termination signals sent by process managers or the kernel.
  // SIGTERM: sent by systemd, launchd, Docker, or `kill <pid>`.
  // SIGHUP:  sent when the controlling terminal closes (e.g. SSH disconnect).
  // SIGINT (Ctrl-C) is already handled by Node.js default behaviour.
  process.once("SIGTERM", () => process.exit(0));
  process.once("SIGHUP", () => process.exit(0));

  await server.connect(transport);
}

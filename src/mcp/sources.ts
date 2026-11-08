import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadFederation, type FederationSource } from "../core/federation.js";
import { buildContext, type ServerContext } from "./context.js";

export interface SourceHandle extends FederationSource {
  ctx: ServerContext;
}

export interface SourceRegistry {
  /**
   * The sources that can answer now, plus one line for each source skipped that was not reported before.
   * The first call builds the contexts; a source with no usable index builds it in the background and is skipped until ready.
   */
  open(): Promise<{ ready: SourceHandle[]; notes: string[] }>;
}

/** `<primary index>/sources/<label>-<hash8>`: nothing is ever written into the source's own tree. */
export function sourceIndexPath(primaryIndexPath: string, s: FederationSource): string {
  return join(primaryIndexPath, "sources", `${s.label}-${createHash("sha256").update(s.path).digest("hex").slice(0, 8)}`);
}

/** Why a source cannot be indexed, or undefined. */
function unreadable(path: string): string | undefined {
  try {
    if (!statSync(path).isDirectory()) return "not a directory";
    readdirSync(path);
  } catch (e: any) {
    return e?.code === "ENOENT" ? "path not found" : `unreadable (${e?.code ?? e?.message})`;
  }
}

/** Label of the server's own vault in `source` fields and `read_note`. */
export const PRIMARY_LABEL = "primary";

const registries = new WeakMap<ServerContext, SourceRegistry>();
/** The one registry per server context, shared by the search and read tools. */
export const registryFor = (primary: ServerContext): SourceRegistry => registries.get(primary) ?? (registries.set(primary, createSourceRegistry(primary)), registries.get(primary)!);

export function createSourceRegistry(primary: ServerContext): SourceRegistry {
  let handles: Promise<SourceHandle[]> | null = null;
  const skipped = new Map<string, string>(); // label -> reason, fixed at first open
  const reported = new Set<string>();

  async function start(): Promise<SourceHandle[]> {
    const fed = loadFederation(primary.notesPath);
    for (const w of fed.warnings) process.stderr.write(`${w}\n`);
    const out: SourceHandle[] = [];
    for (const s of fed.sources) {
      const why = unreadable(s.path);
      if (why) {
        skipped.set(s.label, `${why}: ${s.path}`);
        continue;
      }
      try {
        const ctx = await buildContext(s.path, { readOnly: true, indexPath: sourceIndexPath(primary.indexPath, s), embedder: primary.embedder, telemetry: false });
        ctx.tryLoadCachedIndex()
          .then((cached) => (cached ? ctx.reconcileNow() : ctx.backgroundIndex()))
          .catch(() => ctx.backgroundIndex());
        out.push({ ...s, ctx });
      } catch (e: any) {
        skipped.set(s.label, `could not be opened: ${e?.message ?? e}`);
      }
    }
    return out;
  }

  return {
    async open() {
      const all = await (handles ??= start());
      const ready: SourceHandle[] = [];
      const reasons = new Map(skipped);
      for (const h of all) {
        const state = h.ctx.getIndexState();
        if (state === "ready" || state === "stale") ready.push(h);
        else reasons.set(h.label, "still indexing");
      }
      const notes: string[] = [];
      for (const [label, why] of reasons) {
        const line = `[federation: source "${label}" skipped, ${why}]`;
        if (reported.has(line)) continue;
        reported.add(line);
        process.stderr.write(`${line}\n`);
        notes.push(line);
      }
      return { ready, notes };
    },
  };
}

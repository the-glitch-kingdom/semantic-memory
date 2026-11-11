import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coldChecksum } from "../core/cold.js";
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
  /**
   * Opt-in sources (`default: false`, cold generations) by label, built only now: default traffic never calls this.
   * `long-term` expands to every cold generation; a default source or `primary` is ignored (open() has it); `unknown` are labels
   * nothing is registered under. `notes` are one line each, for a source that is skipped, still indexing or changed.
   */
  openOptIn(labels: string[]): Promise<{ ready: SourceHandle[]; notes: string[]; unknown: string[] }>;
  /** One row per configured source for get_stats; never opens a source. */
  list(): Promise<{ label: string; default: boolean; locked: boolean; state: string; generation?: string }[]>;
  /** The explicit human rebuild of one source (a changed locked source included); returns a one-line result. */
  reindex(label: string): Promise<string>;
}

interface OptIn {
  handle?: SourceHandle;
  skip?: string;
  /** checksum of the folder when last verified, and its mtime then */
  sum?: string;
  mtime: number;
  /** this process started the build, so the folder it hashed is the one indexed */
  builtHere: boolean;
}

/** A locked source with no manifest checksum records its own at build time, next to its index. */
const RECORD = "locked.json";

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
  let fed: ReturnType<typeof loadFederation> | null = null;
  const federation = () => {
    if (!fed) {
      fed = loadFederation(primary.notesPath);
      for (const w of fed.warnings) process.stderr.write(`${w}\n`);
    }
    return fed;
  };

  async function start(): Promise<SourceHandle[]> {
    const out: SourceHandle[] = [];
    // opt-in sources stay closed until openOptIn; building one here would put it in every search
    for (const s of federation().sources.filter((x) => x.default)) {
      const why = unreadable(s.path);
      if (why) {
        skipped.set(s.label, `${why}: ${s.path}`);
        continue;
      }
      try {
        const ctx = await buildContext(s.path, { readOnly: true, indexPath: sourceIndexPath(primary.indexPath, s), embedder: primary.embedder, telemetry: false });
        ctx.reranker = null; // a source's own rerank block would load a second model and score on a scale the merge cannot compare
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

  const optIn = new Map<string, Promise<OptIn>>();
  const mtimeOf = (path: string) => { try { return statSync(path).mtimeMs; } catch { return 0; } };

  async function openOne(s: FederationSource): Promise<OptIn> {
    const mtime = mtimeOf(s.path);
    const why = unreadable(s.path);
    if (why) return { skip: `${why}: ${s.path}`, mtime, builtHere: false };
    // shortcut: hashed once per process and again only when the folder's own mtime moves; an in-place edit of a locked file is not seen until restart
    const sum = s.locked ? coldChecksum(s.path) : undefined;
    if (s.checksum && sum !== s.checksum.toLowerCase()) return { skip: "checksum does not match the manifest, the folder changed after it was registered", mtime, builtHere: false };
    try {
      const indexPath = sourceIndexPath(primary.indexPath, s);
      const ctx = await buildContext(s.path, { readOnly: true, indexPath, embedder: primary.embedder, telemetry: false, locked: s.locked, skipFiles: s.secrets });
      ctx.reranker = null;
      const cached = await ctx.tryLoadCachedIndex().catch(() => false);
      // a locked source never reconciles: it was verified above and is served as indexed
      if (cached && !s.locked) ctx.reconcileNow().catch(() => ctx.backgroundIndex());
      if (!cached) ctx.backgroundIndex();
      return { handle: { ...s, ctx }, sum, mtime, builtHere: !cached };
    } catch (e: any) {
      return { skip: `could not be opened: ${e?.message ?? e}`, mtime, builtHere: false };
    }
  }

  return {
    async list() {
      const started = handles ? await handles : [];
      return Promise.all(federation().sources.map(async (s) => {
        const h = started.find((x) => x.label === s.label) ?? (await optIn.get(s.label))?.handle;
        const state = h ? h.ctx.getIndexState() : skipped.has(s.label) || (await optIn.get(s.label))?.skip ? "skipped" : "not opened";
        return { label: s.label, default: s.default, locked: s.locked, state, ...(s.historical && { generation: s.historical.generation }) };
      }));
    },
    async reindex(label) {
      const s = federation().sources.find((x) => x.label === label);
      if (!s) return `Unknown source "${label}".`;
      const h = s.default ? (await this.open()).ready.find((x) => x.label === label) : (await this.openOptIn([label])).ready[0];
      if (!h) return `Source "${label}" cannot be rebuilt now (skipped or still indexing).`;
      await h.ctx.fullIndex();
      const e = await optIn.get(label);
      if (e && s.locked) { // the rebuilt tree is the new baseline for the "changed since it was indexed" check
        e.sum = coldChecksum(s.path);
        e.mtime = mtimeOf(s.path);
        if (!s.checksum) writeFileSync(join(h.ctx.indexPath, RECORD), JSON.stringify({ checksum: e.sum }));
      }
      return `Reindexed source "${label}": ${h.ctx.getDocuments().length} notes`;
    },
    async openOptIn(labels) {
      const all = federation().sources;
      const unknown: string[] = [];
      const want = new Set<string>();
      for (const l of labels) {
        if (l === "primary") continue;
        if (l === "long-term") all.filter((s) => s.historical).forEach((s) => want.add(s.label));
        else if (all.some((s) => s.label === l)) want.add(l);
        else unknown.push(l);
      }
      const ready: SourceHandle[] = [];
      const notes: string[] = [];
      for (const s of all.filter((x) => !x.default && want.has(x.label))) {
        if (!optIn.has(s.label)) optIn.set(s.label, openOne(s));
        const e = await optIn.get(s.label)!;
        let note = e.skip && `skipped, ${e.skip}`;
        const h = e.handle;
        if (!note && h) {
          const recordFile = join(h.ctx.indexPath, RECORD);
          const m = mtimeOf(s.path);
          if (m !== e.mtime) { // the folder moved since it was verified
            e.mtime = m;
            const now = coldChecksum(s.path);
            if (s.checksum && now !== s.checksum.toLowerCase()) note = "skipped, checksum does not match the manifest, the folder changed after it was registered";
            else e.sum = now;
          }
          if (!note && s.locked && !s.checksum && e.sum) {
            let recorded: string | undefined;
            try { recorded = JSON.parse(readFileSync(recordFile, "utf-8")).checksum; } catch { /* not recorded yet */ }
            if (!recorded && e.builtHere && h.ctx.getIndexState() === "ready") writeFileSync(recordFile, JSON.stringify({ checksum: e.sum }));
            else if (recorded && e.sum !== recorded) note = "changed since it was indexed, the old index is still answering";
          }
          if (!note || note.startsWith("changed")) {
            const state = h.ctx.getIndexState();
            if (state === "ready" || state === "stale") ready.push(h);
            else note = "skipped, still indexing";
          }
        }
        if (note) notes.push(`[federation: source "${s.label}" ${note}]`);
      }
      for (const n of notes) if (!reported.has(n)) { reported.add(n); process.stderr.write(`${n}\n`); }
      return { ready, notes, unknown };
    },
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

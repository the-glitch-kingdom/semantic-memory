import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { CHUNKER, IGNORE_GLOBS, INDEX_SCHEMA_VERSION } from "./indexer.js";
import { sha256 } from "./reconcile.js";
import { indexExclude, type PathClassConfig } from "./path-class.js";
import type { IndexFields } from "./fields.js";

/**
 * Files that must all come from one commit. embeddings.json is not one of them: it is keyed by
 * chunk text, so any version of it is valid for any index.
 */
export const COMMIT_FILES = ["hnsw.bin", "hnsw-meta.json", "graph.json", "docs.cache.json", "manifest.json"];

export interface IndexMeta {
  schemaVersion: number;
  chunker: typeof CHUNKER;
  ignoreGlobs: string;
  generation: number;
  model: string;
  dimensions: number;
  totalChunks: number;
  /** median top BM25 score of title self-queries (bm25SelfTop): the corpus scale for the no_strong_match lexical threshold; absent in older indexes */
  bm25SelfTop?: number | null;
  indexedAt: string;
  /** size + mtime of each commit file as written; a reader that sees anything else caught a half-finished commit */
  files: Record<string, { size: number; mtimeMs: number }>;
}

/** Which docs are indexed and which fields feed them: the inputs of `ignoreGlobsHash`. `meta_weight` is a search-time knob and is not one. */
export const parserInputs = (pathClass: PathClassConfig, fields: IndexFields): string[] => [
  ...indexExclude(pathClass),
  JSON.stringify([fields.lexical, fields.vector, fields.symptom_keys]),
];

/** Everything that decides which files are indexed: a change re-parses the corpus. */
export const ignoreGlobsHash = (exclude: string[]): string => sha256(JSON.stringify([IGNORE_GLOBS, exclude])).slice(0, 16);

export async function readMeta(indexPath: string): Promise<IndexMeta | null> {
  try {
    return JSON.parse(await readFile(join(indexPath, "meta.json"), "utf-8"));
  } catch {
    return null;
  }
}

export const metaMtime = async (indexPath: string): Promise<number> =>
  stat(join(indexPath, "meta.json")).then((s) => s.mtimeMs, () => 0);

/** Parsed docs, edges and chunk text are only valid for the parser that wrote them. */
export function parserMatches(meta: IndexMeta | null, exclude: string[]): boolean {
  return (
    !!meta &&
    meta.schemaVersion === INDEX_SCHEMA_VERSION &&
    JSON.stringify(meta.chunker) === JSON.stringify(CHUNKER) &&
    meta.ignoreGlobs === ignoreGlobsHash(exclude)
  );
}

/** True when every commit file is the one meta.json describes (meta is written last, so it is the commit marker). */
export async function filesMatchMeta(indexPath: string, meta: IndexMeta): Promise<boolean> {
  for (const name of COMMIT_FILES) {
    const want = meta.files?.[name];
    if (!want) return false;
    try {
      const st = await stat(join(indexPath, name));
      if (st.size !== want.size || st.mtimeMs !== want.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Meta plus consistency, for readers that never write (the CLI/hook search path). */
export async function readConsistentMeta(indexPath: string, exclude: string[]): Promise<IndexMeta | null> {
  const meta = await readMeta(indexPath);
  return meta && parserMatches(meta, exclude) && (await filesMatchMeta(indexPath, meta)) ? meta : null;
}

const LOCK_STALE_MS = 10 * 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/** True while a live process holds the write lock: the committed index being read is about to be replaced. */
export async function indexRebuilding(indexPath: string): Promise<boolean> {
  try {
    const holder = JSON.parse(await readFile(join(indexPath, "index.lock"), "utf-8")) as { pid?: number; at?: number };
    return !!holder.pid && alive(holder.pid) && Date.now() - (holder.at ?? 0) <= LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** One writer per index dir. Returns false when a live process holds the lock; a dead or very old holder is taken over. */
export async function withLock(indexPath: string, fn: () => Promise<void>): Promise<boolean> {
  const lock = join(indexPath, "index.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      try {
        await fn();
      } finally {
        await unlink(lock).catch(() => {});
      }
      return true;
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      let holder: { pid?: number; at?: number } = {};
      try {
        holder = JSON.parse(await readFile(lock, "utf-8"));
      } catch {
        /* unreadable lock file: treat as stale */
      }
      const stale = !holder.pid || !alive(holder.pid) || Date.now() - (holder.at ?? 0) > LOCK_STALE_MS;
      if (!stale) return false;
      await unlink(lock).catch(() => {});
    }
  }
  return false;
}

/**
 * Commit a new generation: `write(stageDir)` produces the commit files in a staging dir, then (under the
 * lock) each is renamed into place and meta.json goes last. Returns the new meta, or null when the lock is
 * busy or another process committed since `expectedGeneration` (the caller reloads instead of overwriting).
 */
export async function commitIndex(
  indexPath: string,
  expectedGeneration: number,
  info: Pick<IndexMeta, "model" | "dimensions" | "totalChunks" | "ignoreGlobs" | "bm25SelfTop">,
  write: (stageDir: string) => Promise<void>
): Promise<IndexMeta | null> {
  const stage = join(indexPath, `.stage-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await mkdir(stage, { recursive: true });
  let result: IndexMeta | null = null;
  try {
    await write(stage);
    const ran = await withLock(indexPath, async () => {
      const onDisk = await readMeta(indexPath);
      if ((onDisk?.generation ?? 0) !== expectedGeneration) return;
      const files: IndexMeta["files"] = {};
      for (const name of COMMIT_FILES) {
        if (!existsSync(join(stage, name))) continue;
        const st = await stat(join(stage, name));
        files[name] = { size: st.size, mtimeMs: st.mtimeMs };
        await rename(join(stage, name), join(indexPath, name));
      }
      const meta: IndexMeta = {
        schemaVersion: INDEX_SCHEMA_VERSION,
        chunker: CHUNKER,
        generation: expectedGeneration + 1,
        ...info,
        indexedAt: new Date().toISOString(),
        files,
      };
      await writeFile(join(stage, "meta.json"), JSON.stringify(meta));
      await rename(join(stage, "meta.json"), join(indexPath, "meta.json"));
      result = meta;
    });
    return ran ? result : null;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { listMarkdown } from "./indexer.js";

/** What the last index saw of each file. Frontmatter dates are never used here: only fs.stat and bytes. */
export interface ManifestEntry {
  mtimeMs: number;
  size: number;
  ino: number;
  contentHash: string;
}
export type Manifest = Record<string, ManifestEntry>;

export interface ReconcilePlan {
  /** new files and files whose bytes changed: re-parse these */
  parse: string[];
  /** in the manifest but no longer on disk */
  gone: string[];
  /** the manifest after this pass (touched-but-identical files get their new stat) */
  manifest: Manifest;
  /** anything differs from `prev`, including a stat change with identical bytes */
  changed: boolean;
}

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/**
 * Walk + stat the tree and diff it against the manifest. Same stat -> skipped without reading;
 * stat changed but same bytes (touch, git checkout) -> manifest only; bytes changed or new -> parse.
 * An unreadable file keeps its previous entry, so it is retried next time and never fatal.
 */
export async function reconcile(notesPath: string, prev: Manifest, skip: string[] = [], noLinks = false): Promise<ReconcilePlan> {
  const files = await listMarkdown(notesPath, skip, noLinks);
  const manifest: Manifest = {};
  const parse: string[] = [];
  let changed = false;

  await Promise.all(
    files.map(async (file) => {
      const old = prev[file];
      try {
        const st = await stat(join(notesPath, file));
        if (old && old.mtimeMs === st.mtimeMs && old.size === st.size && old.ino === st.ino) {
          manifest[file] = old;
          return;
        }
        const contentHash = sha256(await readFile(join(notesPath, file)));
        manifest[file] = { mtimeMs: st.mtimeMs, size: st.size, ino: st.ino, contentHash };
        changed = true;
        if (!old || old.contentHash !== contentHash) parse.push(file);
      } catch (err: any) {
        process.stderr.write(`Skipping ${file}: ${err?.message ?? err}\n`);
        if (old) manifest[file] = old;
      }
    })
  );

  // completion order is I/O timing; the index is built in this order and HNSW is order-sensitive (#85)
  parse.sort();
  const onDisk = new Set(files);
  const gone = Object.keys(prev).filter((f) => !onDisk.has(f));
  return { parse, gone, manifest, changed: changed || gone.length > 0 };
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The blob id git gives these bytes. */
export const gitBlobId = (data: Buffer): string => createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");

/**
 * Last commit of every file under `dir`, from ONE `git log --raw` (never one call per file or per query).
 * path (relative to dir) -> { commit time, blob id of the committed bytes }. Callers compare the blob id with the file on disk, so an
 * edited-since-commit file gets no date. Empty outside a repo or when git fails. Newest commit first, so the first line per path wins.
 * shortcut: paths with tabs, newlines or quotes are skipped and a shallow clone dates old files at its boundary commit.
 */
export async function gitCommitDates(dir: string): Promise<Map<string, { ms: number; blob: string }>> {
  const out = new Map<string, { ms: number; blob: string }>();
  let stdout: string;
  try {
    ({ stdout } = await run("git", ["-C", dir, "-c", "core.quotepath=off", "log", "--relative", "--raw", "--no-renames", "--no-abbrev", "--format=%ct", "--", "."], { maxBuffer: 1 << 28 }));
  } catch {
    return out;
  }
  let ms = 0;
  for (const line of stdout.split("\n")) {
    if (/^\d+$/.test(line)) ms = Number(line) * 1000;
    else if (line.startsWith(":")) {
      const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]\t(.+)$/.exec(line);
      if (m && !out.has(m[2])) out.set(m[2], { ms, blob: m[1] }); // a delete has the all-zero blob, which no file matches
    }
  }
  return out;
}

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { parseFrontmatter } from "./indexer.js";

const run = promisify(execFile);

/** The blob id git gives these bytes. */
export const gitBlobId = (data: Buffer): string => createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");

export interface GitVersion { ms: number; blob: string }

/**
 * Last commit of every file under `dir`, from ONE `git log --raw` (never one call per file or per query).
 * path (relative to dir) -> its commits, newest first, each { commit time, blob id of the committed bytes }. Callers compare the newest
 * blob id with the file on disk, so an edited-since-commit file gets no date. Empty outside a repo or when git fails.
 * shortcut: paths with tabs, newlines or quotes are skipped and a shallow clone dates old files at its boundary commit.
 */
export async function gitCommitDates(dir: string): Promise<Map<string, GitVersion[]>> {
  const out = new Map<string, GitVersion[]>();
  let stdout: string;
  try {
    ({ stdout } = await run("git", ["-C", dir, "-c", "core.quotepath=off", "log", "--relative", "--raw", "--no-renames", "--no-abbrev", "--format=%ct", "--", "."], { maxBuffer: 1 << 28, timeout: 60_000 }));
  } catch {
    return out;
  }
  let ms = 0;
  for (const line of stdout.split("\n")) {
    if (/^\d+$/.test(line)) ms = Number(line) * 1000;
    else if (line.startsWith(":")) {
      const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]\t(.+)$/.exec(line);
      if (m) (out.get(m[2]) ?? out.set(m[2], []).get(m[2])!).push({ ms, blob: m[1] }); // a delete has the all-zero blob, which no file matches
    }
  }
  return out;
}

const MAX_WALK = 20; // shortcut: a body unchanged across 20 commits is dated at the 20th, so it decays slightly less than it should
const ZERO = /^0+$/;

/**
 * Date of the last BODY change (text after the frontmatter, as `parseFrontmatter` splits it) for each path whose newest commit is the
 * file on disk. A frontmatter-only commit does not move it; a file's first commit counts. Blobs are read through ONE `git cat-file
 * --batch` process for the whole call (none when no path has more than one commit). A failure leaves the newest commit date.
 */
export async function gitBodyDates(dir: string, history: Map<string, GitVersion[]>, paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const todo = paths.filter((p) => history.has(p));
  for (const p of todo) out.set(p, history.get(p)![0].ms);
  if (!todo.some((p) => history.get(p)!.length > 1)) return out;

  const proc = spawn("git", ["-C", dir, "cat-file", "--batch"], { stdio: ["pipe", "pipe", "ignore"] });
  const timer = setTimeout(() => proc.kill(), 60_000);
  let buf = Buffer.alloc(0);
  let closed = false;
  let wake: (() => void) | undefined;
  proc.stdout.on("data", (d: Buffer) => { buf = Buffer.concat([buf, d]); wake?.(); });
  proc.on("close", () => { closed = true; wake?.(); });
  proc.stdin.on("error", () => {});
  // "<oid> blob <size>\n<bytes>\n" per request, answered in order
  const body = async (oid: string): Promise<string> => {
    proc.stdin.write(`${oid}\n`);
    for (;;) {
      const nl = buf.indexOf(10);
      if (nl >= 0) {
        const [, type, size] = buf.subarray(0, nl).toString().split(" ");
        if (type !== "blob") { buf = buf.subarray(nl + 1); throw new Error(`git cat-file: ${oid} ${type}`); }
        if (buf.length >= nl + 2 + Number(size)) {
          const raw = buf.subarray(nl + 1, nl + 1 + Number(size)).toString("utf-8");
          buf = buf.subarray(nl + 2 + Number(size));
          return parseFrontmatter(raw, oid).content;
        }
      }
      if (closed) throw new Error("git cat-file closed");
      await new Promise<void>((r) => (wake = r));
    }
  };
  try {
    for (const p of todo) {
      const h = history.get(p)!;
      try {
        let cur = await body(h[0].blob);
        for (let i = 0; i < MAX_WALK && i + 1 < h.length && !ZERO.test(h[i + 1].blob); i++) {
          const prev = await body(h[i + 1].blob);
          if (prev !== cur) break;
          cur = prev;
          out.set(p, h[i + 1].ms);
        }
      } catch {
        if (closed) break;
      }
    }
  } finally {
    clearTimeout(timer);
    proc.stdin.end();
    proc.kill();
  }
  return out;
}

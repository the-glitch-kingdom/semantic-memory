import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { coldStorageDisabled, readColdManifest } from "./federation.js";

const HEWTD_CONFIG = join(".claude", "hit-em-with-the-docs.json");

/**
 * hit-em-with-the-docs 3.2.0 `compute_tree_checksum`: sha256 over the sorted `relpath\0sha256(file)` lines joined by `\n`;
 * a symlink contributes `relpath\0link:sha256(target)` (not followed). `only` limits it to those relative paths.
 */
export function coldChecksum(dir: string, only?: Set<string>): string {
  const sha = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");
  const lines: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (only && !e.isDirectory() && !only.has(r)) continue;
      if (e.isSymbolicLink()) lines.push(`${r}\0link:${sha(readlinkSync(join(dir, r)))}`);
      else if (e.isDirectory()) walk(r);
      else if (e.isFile()) lines.push(`${r}\0${sha(readFileSync(join(dir, r)))}`);
    }
  };
  walk("");
  return sha(lines.sort().join("\n"));
}

/**
 * Whether a generation folder matches its manifest. `checksum` covers the git-tracked files, `disk_checksum` every file
 * (a fresh clone lacks the gitignored ones). shortcut: when only the tracked files match, an edited disk-only file is not caught.
 */
export function coldMatches(dir: string, checksum?: string, diskChecksum?: string): boolean {
  const want = (checksum ?? "").toLowerCase();
  const full = coldChecksum(dir).toLowerCase();
  if (full === (diskChecksum || checksum || "").toLowerCase()) return true;
  try {
    const tracked = new Set(execFileSync("git", ["ls-files", "-z"], { cwd: dir, encoding: "utf-8" }).split("\0").filter(Boolean));
    return tracked.size > 0 && coldChecksum(dir, tracked).toLowerCase() === want;
  } catch { return false; }
}

export type ColdStatus = "registered" | "unregistered" | "checksum-mismatch" | "disabled" | "missing-path";

export interface ColdGeneration {
  generation: string;
  /** Absolute folder. */
  path: string;
  status: ColdStatus;
}

export interface ColdState {
  /** Absolute cold root (`reconcile.cold_root`, default `.documentation-cold`). */
  root: string;
  /** Set when the configured cold root is unusable; no generation is then listed. */
  problem?: "outside-repo" | "inside-docs";
  generations: ColdGeneration[];
}

function readCfg(projectRoot: string): Record<string, any> {
  try { return JSON.parse(readFileSync(join(projectRoot, HEWTD_CONFIG), "utf-8")) ?? {}; } catch { return {}; }
}

/**
 * Every generation under the cold root joined with the manifest. `notesPath` (the primary docs tree) is only read
 * for `federation.cold_storage: false`. Hashes each registered generation (readdir, JSON and one pass over the files)
 * so a checksum change is caught; shortcut: no cache, cold trees are small, add an mtime cache if a hook gets slow.
 */
export function coldGenerations(projectRoot: string, notesPath?: string): ColdState {
  const cfg = readCfg(projectRoot);
  const configured = cfg.reconcile?.cold_root;
  const root = resolve(projectRoot, typeof configured === "string" && configured ? configured : ".documentation-cold");
  const docs = resolve(projectRoot, typeof (cfg.docs_root ?? cfg.docs_path) === "string" ? (cfg.docs_root ?? cfg.docs_path) : ".documentation");
  const within = (base: string, p: string) => { const r = relative(base, p); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
  if (!within(projectRoot, root) || root === resolve(projectRoot)) return { root, problem: "outside-repo", generations: [] };
  if (within(docs, root)) return { root, problem: "inside-docs", generations: [] };

  const disabled = notesPath !== undefined && coldStorageDisabled(notesPath);
  const manifest = new Map(readColdManifest(projectRoot, []).map((s) => [s.historical!.generation, s]));
  const onDisk = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name)
    : [];
  const generations: ColdGeneration[] = [];
  for (const gen of new Set([...onDisk, ...manifest.keys()])) {
    const entry = manifest.get(gen);
    const path = entry?.path ?? join(root, gen);
    let status: ColdStatus;
    if (!entry) status = "unregistered";
    else if (!existsSync(path)) status = "missing-path";
    else if (disabled) status = "disabled";
    else status = coldMatches(path, entry.checksum, entry.diskChecksum) ? "registered" : "checksum-mismatch";
    if (disabled && status === "unregistered") status = "disabled";
    generations.push({ generation: gen, path, status });
  }
  return { root, generations: generations.sort((a, b) => a.generation.localeCompare(b.generation)) };
}

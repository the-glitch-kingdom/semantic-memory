import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { coldStorageDisabled, readColdManifest } from "./federation.js";

const HEWTD_CONFIG = join(".claude", "hit-em-with-the-docs.json");

/**
 * sha256 over the sorted `relpath\0sha256(file)\n` lines of every regular file (symlinks not followed). The definition
 * hit-em-with-the-docs#97 must also use for `cold_storage[].checksum`.
 */
export function coldChecksum(dir: string): string {
  const lines: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile()) lines.push(`${r}\0${createHash("sha256").update(readFileSync(join(dir, r))).digest("hex")}\n`);
    }
  };
  walk("");
  return createHash("sha256").update(lines.sort().join("")).digest("hex");
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
    else status = coldChecksum(path).toLowerCase() === entry.checksum?.toLowerCase() ? "registered" : "checksum-mismatch";
    if (disabled && status === "unregistered") status = "disabled";
    generations.push({ generation: gen, path, status });
  }
  return { root, generations: generations.sort((a, b) => a.generation.localeCompare(b.generation)) };
}

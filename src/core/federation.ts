import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface FederationSource {
  label: string;
  /** Absolute path of the source's docs tree (read-only). */
  path: string;
  weight: number;
}

export interface Federation {
  sources: FederationSource[];
  /** Dropped entries, one line each; the caller logs them once. */
  warnings: string[];
}

const LABEL = /^[\w.-]+$/;
const HEWTD_CONFIG = join(".claude", "hit-em-with-the-docs.json");

function real(p: string): string {
  try { return realpathSync(p); } catch { return resolve(p); } // a missing path stays; Phase 3 reports it
}

function readJson(p: string): unknown {
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return undefined; }
}

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function asRecord(x: unknown): Record<string, unknown> | undefined {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined;
}

/** Walk up to the dir holding hewtd's config or a .git; hewtd resolves related_repos paths from there. */
function projectRoot(from: string): string | undefined {
  for (let d = resolve(from); ; d = dirname(d)) {
    if (existsSync(join(d, HEWTD_CONFIG)) || existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

/** hewtd `reconcile.related_repos[{name, path}]`: each sibling's docs tree is its own `docs_root` (`docs_path` before hewtd 3.0), else `.documentation`. */
function relatedRepos(notesPath: string, warnings: string[]): FederationSource[] {
  const root = projectRoot(notesPath);
  if (!root) return [];
  const cfgPath = join(root, HEWTD_CONFIG);
  if (!existsSync(cfgPath)) return [];
  const repos = asRecord(asRecord(readJson(cfgPath))?.reconcile)?.related_repos;
  if (!Array.isArray(repos)) return [];
  const out: FederationSource[] = [];
  for (const r of repos) {
    const e = asRecord(r);
    if (!e || typeof e.name !== "string" || !LABEL.test(e.name) || typeof e.path !== "string" || !e.path) {
      warnings.push(`federation: ignored a malformed related_repos entry in ${HEWTD_CONFIG}`);
      continue;
    }
    const repo = resolve(root, e.path);
    const sib = asRecord(readJson(join(repo, HEWTD_CONFIG)));
    const own = sib?.docs_root ?? sib?.docs_path; // `docs_path` up to hewtd 2.x, `docs_root` from 3.0.0
    // a sibling's own config must not point the index outside that sibling (e.g. docs_root: "../../.ssh")
    const inside = (d: string) => !relative(repo, d).startsWith("..") && !isAbsolute(relative(repo, d));
    const docs = [typeof own === "string" && own ? resolve(repo, own) : "", join(repo, ".documentation")].find((d) => d && inside(d) && isDir(d));
    if (!docs) {
      warnings.push(`federation: related repo "${e.name}" has no docs tree (docs_root or .documentation); skipped`);
      continue;
    }
    out.push({ label: e.name, path: docs, weight: 1 });
  }
  return out;
}

/**
 * Read `federation:` from the vault's vault.schema.yml, plus hewtd's related_repos when its config exists.
 * Lenient: a bad entry is dropped with a warning, never thrown. The primary and duplicate paths/labels are left out.
 */
export function loadFederation(notesPath: string): Federation {
  const warnings: string[] = [];
  let block: Record<string, unknown> | undefined;
  try {
    const schemaPath = join(notesPath, "vault.schema.yml");
    if (existsSync(schemaPath)) block = asRecord(asRecord(parseYaml(readFileSync(schemaPath, "utf-8")))?.federation);
  } catch {
    warnings.push("federation: vault.schema.yml is not valid YAML; federation ignored");
  }

  const candidates: FederationSource[] = [];
  if (Array.isArray(block?.sources)) {
    for (const s of block.sources) {
      const e = asRecord(s);
      if (!e || typeof e.path !== "string" || !e.path) {
        warnings.push("federation: ignored a source without a path");
        continue;
      }
      const path = isAbsolute(e.path) ? e.path : resolve(notesPath, e.path);
      const label = e.label === undefined ? basename(path) : e.label;
      if (typeof label !== "string" || !LABEL.test(label)) {
        warnings.push(`federation: ignored source ${e.path}: label must match ${LABEL}`);
        continue;
      }
      const weight = e.weight === undefined ? 1 : e.weight;
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        warnings.push(`federation: ignored source "${label}": weight must be a positive number`);
        continue;
      }
      candidates.push({ label, path, weight });
    }
  } else if (block?.sources !== undefined) {
    warnings.push("federation: sources must be a list; ignored");
  }
  // related_repos defaults on; hewtd's config file is what makes it do anything
  if (block?.related_repos !== false) candidates.push(...relatedRepos(notesPath, warnings));

  const seenPaths = new Set([real(notesPath)]);
  const seenLabels = new Set<string>();
  const sources: FederationSource[] = [];
  for (const c of candidates) {
    const rp = real(c.path);
    if (seenPaths.has(rp) || seenLabels.has(c.label)) continue;
    seenPaths.add(rp);
    seenLabels.add(c.label);
    sources.push({ ...c, path: rp });
  }
  return { sources, warnings };
}

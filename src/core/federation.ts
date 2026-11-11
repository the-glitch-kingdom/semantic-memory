import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface FederationSource {
  label: string;
  /** Absolute path of the source's docs tree (read-only). */
  path: string;
  weight: number;
  /** Searched when a query names no source. False for opt-in sources. */
  default: boolean;
  /** Never reconciled or re-indexed after its first build; a changed folder is a checksum event (Phase 4). */
  locked: boolean;
  /** Set on cold generations only. */
  historical?: { generation: string; source_commit: string; rotated_at: string };
  /** The manifest's checksum of the generation folder (cold generations only). */
  checksum?: string;
  /** Paths, relative to the generation, that the rotation's secrets scan flagged (cold generations only). */
  secrets?: string[];
}

export interface Federation {
  sources: FederationSource[];
  /** Dropped entries, one line each; the caller logs them once. */
  warnings: string[];
}

const LABEL = /^[\w.-]+$/;
const RESERVED_LABELS = new Set(["primary", "long-term"]);
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

function inside(base: string, p: string): boolean {
  const r = relative(base, p);
  return !r.startsWith("..") && !isAbsolute(r);
}

/** Walk up to the dir holding hewtd's config or a .git; hewtd resolves related_repos paths from there. */
export function projectRoot(from: string): string | undefined {
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
    const docs = [typeof own === "string" && own ? resolve(repo, own) : "", join(repo, ".documentation")].find((d) => d && inside(repo, d) && isDir(d));
    if (!docs) {
      warnings.push(`federation: related repo "${e.name}" has no docs tree (docs_root or .documentation); skipped`);
      continue;
    }
    out.push({ label: e.name, path: docs, weight: 1, default: true, locked: false });
  }
  return out;
}

/** `rel/path.md:51` -> `rel/path.md`; entries that are absolute or climb out of the generation are dropped. */
function secretPaths(findings: unknown): string[] {
  if (!Array.isArray(findings)) return [];
  const out = new Set<string>();
  for (const f of findings) {
    if (typeof f !== "string") continue;
    const rel = f.replace(/:\d+$/, "").replaceAll("\\", "/");
    if (rel && !isAbsolute(rel) && !rel.split("/").includes("..")) out.add(rel);
  }
  return [...out];
}

/**
 * hewtd's `cold_storage[]` manifest (hit-em-with-the-docs#97) as locked, opt-in sources. The folder is not checked for
 * existence here (coldGenerations reports `missing-path`); the path must stay inside the repo, symlinks resolved.
 * A malformed entry is a warning, never a throw.
 */
export function readColdManifest(root: string, warnings: string[]): FederationSource[] {
  const cfg = join(root, HEWTD_CONFIG);
  const list = existsSync(cfg) ? asRecord(readJson(cfg))?.cold_storage : undefined;
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    warnings.push(`federation: cold_storage in ${HEWTD_CONFIG} must be a list; ignored`);
    return [];
  }
  const rootReal = real(root);
  const out: FederationSource[] = [];
  for (const raw of list) {
    const e = asRecord(raw);
    const gen = e?.generation;
    if (!e || typeof gen !== "string" || !LABEL.test(gen) || typeof e.path !== "string" || !e.path) {
      warnings.push(`federation: ignored a malformed cold_storage entry in ${HEWTD_CONFIG}`);
      continue;
    }
    const path = resolve(root, e.path);
    if (isAbsolute(e.path) || !inside(rootReal, real(path))) {
      warnings.push(`federation: cold generation "${gen}" path ${e.path} is outside the repo; skipped`);
      continue;
    }
    const str = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : "");
    out.push({
      label: `cold-${gen}`,
      path,
      weight: 1,
      default: false,
      locked: true,
      historical: { generation: gen, source_commit: str("source_commit"), rotated_at: str("rotated_at") },
      checksum: str("checksum"),
      secrets: secretPaths(e.secrets_findings),
    });
  }
  return out;
}

function federationBlock(notesPath: string, warnings: string[]): Record<string, unknown> | undefined {
  try {
    const schemaPath = join(notesPath, "vault.schema.yml");
    if (existsSync(schemaPath)) return asRecord(asRecord(parseYaml(readFileSync(schemaPath, "utf-8")))?.federation);
  } catch {
    warnings.push("federation: vault.schema.yml is not valid YAML; federation ignored");
  }
  return undefined;
}

/** `federation.cold_storage: false` in the vault's schema. */
export function coldStorageDisabled(notesPath: string): boolean {
  return federationBlock(notesPath, [])?.cold_storage === false;
}

/**
 * Read `federation:` from the vault's vault.schema.yml, plus hewtd's related_repos when its config exists.
 * Lenient: a bad entry is dropped with a warning, never thrown. The primary and duplicate paths/labels are left out.
 */
export function loadFederation(notesPath: string): Federation {
  const warnings: string[] = [];
  const block = federationBlock(notesPath, warnings);

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
      const flag = (k: "default" | "locked", dflt: boolean) => (e[k] === undefined ? dflt : typeof e[k] === "boolean" ? (e[k] as boolean) : undefined);
      const dflt = flag("default", true);
      const locked = flag("locked", false);
      if (dflt === undefined || locked === undefined) {
        warnings.push(`federation: ignored source "${label}": default and locked must be true or false`);
        continue;
      }
      candidates.push({ label, path, weight, default: dflt, locked });
    }
  } else if (block?.sources !== undefined) {
    warnings.push("federation: sources must be a list; ignored");
  }
  // related_repos defaults on; hewtd's config file is what makes it do anything
  const rr = block?.related_repos;
  if (rr !== undefined && rr !== true && rr !== false && rr !== "opt-in") warnings.push("federation: related_repos must be true, false or opt-in; treated as true");
  if (rr !== false) candidates.push(...relatedRepos(notesPath, warnings).map((r) => ({ ...r, default: rr !== "opt-in" })));
  const root = projectRoot(notesPath);
  if (root && block?.cold_storage !== false) {
    for (const c of readColdManifest(root, warnings)) {
      if (isDir(c.path)) candidates.push(c);
      else warnings.push(`federation: cold generation "${c.historical?.generation}" has no folder at its path; skipped`);
    }
  }

  const seenPaths = new Set([real(notesPath)]);
  const seenLabels = new Set<string>();
  const sources: FederationSource[] = [];
  for (const c of candidates) {
    if (RESERVED_LABELS.has(c.label)) {
      warnings.push(`federation: ignored source "${c.label}": the label is reserved`);
      continue;
    }
    const rp = real(c.path);
    if (seenPaths.has(rp) || seenLabels.has(c.label)) continue;
    seenPaths.add(rp);
    seenLabels.add(c.label);
    sources.push({ ...c, path: rp });
  }
  return { sources, warnings };
}

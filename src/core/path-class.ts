import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { minimatch } from "minimatch";
import { DEFAULT_EXCLUDE_HUBS } from "./graph.js";

/**
 * Path-class ranking multiplier (v1.4 Phase 2).
 *
 * Down-weights whole regions of the vault by path glob — the direct fix for the
 * observed failure where `archive/` and `archive/pre-restructure/` copies of a
 * retired doc dominated the top hits. Composes multiplicatively with decay and
 * load_priority at the same `context.ts` rank site; it never removes notes, only
 * ranks them lower. First matching rule wins. `exclude` globs (v1.9) drop matches from
 * search results entirely. Globs match with `dot: true`: `**` otherwise skips dot-dirs,
 * so an archive glob would miss `.documentation/archive/`.
 */

export interface PathClassRule {
  glob: string;
  multiplier: number;
}

export interface PathClassConfig {
  enabled: boolean;
  rules: PathClassRule[];
  /** globs dropped from search results; `[]` opts out and leaves only the down-weight */
  exclude: string[];
  /** `results.exclude`: indexed and linked, but never returned by a search (generated hubs and reports) */
  resultsExclude: string[];
}

const MM = { dot: true };

export const DEFAULT_PATH_CLASS_CONFIG: PathClassConfig = {
  enabled: true,
  rules: [{ glob: "**/archive/**", multiplier: 0.3 }],
  exclude: ["**/archive/**"],
  resultsExclude: [...DEFAULT_EXCLUDE_HUBS, "**/reports/link-check-*.md"],
};

/** The multiplier for a note path — first matching rule, else 1.0 (no effect). */
export function pathClassMultiplier(path: string, config: PathClassConfig): number {
  if (!config.enabled) return 1;
  for (const rule of config.rules) {
    if (typeof rule.multiplier !== "number") continue;
    if (minimatch(path, rule.glob, MM)) return rule.multiplier;
  }
  return 1;
}

export function isExcludedPath(path: string, config: PathClassConfig): boolean {
  return config.enabled && config.exclude.some((g) => minimatch(path, g, MM));
}

/** A doc a search can return: not `generated`, not `exclude`d, not `results.exclude`d. Presence (`missing_terms`) counts only these. */
export const isSearchableDoc = (d: { path: string; generated?: boolean }, config: PathClassConfig): boolean =>
  !d.generated && !isExcludedPath(d.path, config) && !config.resultsExclude.some((g) => minimatch(d.path, g, MM));

/** The globs whose docs are kept out of the index (graph-only nodes): what `isExcludedPath` tests. */
export const indexExclude = (config: PathClassConfig): string[] => (config.enabled ? config.exclude : []);

/**
 * Drop excluded paths. With exclusion opted out, a down-weighted result whose best chunk is
 * identical to a full-weight result's is dropped too (the archived copy of a live doc).
 */
export function filterPathClass<T extends { path: string; matchedChunk?: string }>(results: T[], config: PathClassConfig): T[] {
  results = results.filter((r) => !config.resultsExclude.some((g) => minimatch(r.path, g, MM)));
  if (!config.enabled) return results;
  const live = new Set<string>();
  for (const r of results) if (r.matchedChunk && pathClassMultiplier(r.path, config) === 1) live.add(r.matchedChunk);
  return results.filter(
    (r) =>
      !isExcludedPath(r.path, config) &&
      !(r.matchedChunk && live.has(r.matchedChunk) && pathClassMultiplier(r.path, config) < 1)
  );
}

/**
 * Load `path_class` from vault.schema.yml, merged over the default. Missing file /
 * block / parse error → default. Synchronous + memoization-friendly.
 */
export function loadPathClassConfig(vaultPath: string): PathClassConfig {
  try {
    const schemaPath = join(vaultPath, "vault.schema.yml");
    if (!existsSync(schemaPath)) return DEFAULT_PATH_CLASS_CONFIG;
    const parsed = parseYaml(readFileSync(schemaPath, "utf-8")) as { path_class?: Partial<PathClassConfig>; results?: { exclude?: unknown } } | null;
    const p = parsed?.path_class && typeof parsed.path_class === "object" ? parsed.path_class : {};
    const re = parsed?.results?.exclude;
    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_PATH_CLASS_CONFIG.enabled,
      rules: Array.isArray(p.rules)
        ? p.rules.filter((r): r is PathClassRule => !!r && typeof r.glob === "string" && typeof r.multiplier === "number")
        : DEFAULT_PATH_CLASS_CONFIG.rules,
      exclude: Array.isArray(p.exclude) ? p.exclude.filter((g): g is string => typeof g === "string") : DEFAULT_PATH_CLASS_CONFIG.exclude,
      resultsExclude: Array.isArray(re) ? re.filter((g): g is string => typeof g === "string") : DEFAULT_PATH_CLASS_CONFIG.resultsExclude,
    };
  } catch {
    return DEFAULT_PATH_CLASS_CONFIG;
  }
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { tokenize, type Bm25Index } from "./bm25.js";
import type { VectorIndex } from "./vector.js";
import type { GraphBuilder } from "./graph.js";

export interface RankingConfig {
  /** score *= 1 + coverage_weight * cover(doc, query) */
  coverage_weight: number;
  /** score *= link_prior for a doc with at least link_prior_min_links outgoing link/wikilink edges */
  link_prior: number;
  link_prior_min_links: number;
  /** score *= 1 + clause_weight * clauseCover(doc): the doc answers several clauses of the question with different chunks (#91) */
  clause_weight: number;
}

/**
 * Off by default: swept on the train splits only (retrieval-ready-fields notes.md "Phase 4"), coverage 0.1-0.6 and the
 * issue's link prior 1.1 never gained a train answer and cost one on the real corpus (link-heavy reference docs displaced
 * the specific doc), so the measured default is a no-op. Opt in per vault under `ranking:` in vault.schema.yml.
 * clause_weight is off too: 1 flips the multi-clause fixture and gains train answers, but failed the held-out gate against
 * 1.27.1 (hybrid @1 -1, export -2, BAND 1; whole-answer-ranking Phase 5), so #91 part 2 ships off. Opt in per vault.
 */
export const DEFAULT_RANKING: RankingConfig = { coverage_weight: 0, link_prior: 1, link_prior_min_links: 5, clause_weight: 0 };

/** `ranking` from vault.schema.yml; a missing file, block or bad value gives the default. */
export function loadRanking(vaultPath: string): RankingConfig {
  try {
    const r = (parseYaml(readFileSync(join(vaultPath, "vault.schema.yml"), "utf-8")) as { ranking?: Partial<RankingConfig> } | null)?.ranking;
    const num = (v: unknown, d: number, min: number) => (typeof v === "number" && v >= min ? v : d);
    return {
      coverage_weight: num(r?.coverage_weight, DEFAULT_RANKING.coverage_weight, 0),
      link_prior: num(r?.link_prior, DEFAULT_RANKING.link_prior, 0),
      link_prior_min_links: num(r?.link_prior_min_links, DEFAULT_RANKING.link_prior_min_links, 1),
      clause_weight: num(r?.clause_weight, DEFAULT_RANKING.clause_weight, 0),
    };
  } catch {
    return DEFAULT_RANKING;
  }
}

/**
 * Whole-doc coverage boost and link prior on the fused candidates (MCP `search_hybrid` and the CLI share it).
 * Fusion scores a doc by its best single chunk, so an overview whose sections each match part of a broad query
 * loses to a narrow doc matching one part well; coverage credits the terms spread across the whole doc.
 * Links to excluded paths do not count (hubs and `generated: true` docs are not graph nodes).
 */
export function applyCoverage<T extends { path: string; score: number }>(
  results: T[], query: string, bm25: Bm25Index, graph: GraphBuilder, cfg: RankingConfig, isExcluded: (path: string) => boolean = () => false
): T[] {
  if (cfg.coverage_weight === 0 && cfg.link_prior === 1) return results;
  return results
    .map((r) => {
      let score = r.score * (1 + cfg.coverage_weight * bm25.cover(r.path, query));
      if (cfg.link_prior !== 1 && graph.forwardlinks(r.path, ["link", "wikilink"]).filter((n) => !isExcluded(n.path)).length >= cfg.link_prior_min_links) score *= cfg.link_prior;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** More clauses than this cost one more query embedding each and add little: the rest are dropped. */
export const MAX_CLAUSES = 3;

/** The question's clauses (split on " and ", `,`, `;`, `?`, each with at least 2 non-stop tokens); [] unless there are at least 2. */
export function splitClauses(query: string): string[] {
  const parts = query.split(/\s+and\s+|[,;?]/i).map((c) => c.trim()).filter((c) => tokenize(c).length >= 2);
  return parts.length >= 2 ? parts.slice(0, MAX_CLAUSES) : [];
}

/** Embeds the clauses and credits each fused candidate that answers several of them in different chunks (#91 part 2); a no-op when off or for a one-clause question. */
export async function applyClauses<T extends { path: string; score: number }>(
  results: T[], query: string, vectorIndex: VectorIndex, embed: (text: string) => Promise<Float32Array>, cfg: RankingConfig
): Promise<T[]> {
  const clauses = cfg.clause_weight > 0 ? splitClauses(query) : [];
  if (!clauses.length) return results;
  const vecs = await Promise.all(clauses.map(embed));
  return results
    .map((r) => ({ ...r, score: r.score * (1 + cfg.clause_weight * vectorIndex.clauseCover(r.path, vecs)) }))
    .sort((a, b) => b.score - a.score);
}

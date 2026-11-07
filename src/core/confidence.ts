import { tokenize } from "./bm25.js";
import type { SearchResult } from "./types.js";

/** Calibrated on the train splits (notes.md "Phase 5"): a query whose best cosine is under this and has no BM25 evidence is `no_strong_match`. */
export const NO_STRONG_MATCH_BELOW = 0.36;
/** A neighbour of the top hit must reach this confidence to ride along as `related`. */
export const RELATED_MIN_CONFIDENCE = 0.5;
const LEXICAL_BONUS = 0.1;
export const EXCERPT_CHARS = 600;

/** Confidence in 0..1 per result: its vector cosine, plus a bonus when BM25 also returned it (two or more rare query terms in one chunk). */
export const standaloneConfidence = (r: Pick<SearchResult, "cosine" | "lexical">): number =>
  Math.round(Math.min(1, Math.max(0, (r.cosine ?? 0) + (r.lexical ? LEXICAL_BONUS : 0))) * 100) / 100;

export const withConfidence = <T extends Pick<SearchResult, "cosine" | "lexical">>(results: T[]): (T & { confidence: number })[] =>
  results.map((r) => ({ ...r, confidence: standaloneConfidence(r) }));

/**
 * `no_strong_match`: the best cosine is under NO_STRONG_MATCH_BELOW AND the best raw BM25 score is under `bm25Min`
 * (null = no lexical reference for this index, so only the cosine decides). Either arm's strong evidence keeps the answer.
 * Call on the whole ranked list; empty is not weak.
 */
export function isWeak(results: Pick<SearchResult, "cosine" | "bm25">[], bm25Min: number | null): boolean {
  if (results.length === 0) return false;
  const cos = Math.max(...results.map((r) => r.cosine ?? 0));
  const bm = Math.max(...results.map((r) => r.bm25 ?? 0));
  return cos < NO_STRONG_MATCH_BELOW && (bm25Min === null || bm < bm25Min);
}

/** `max` chars of `text` centred on the first query term it contains (the start when none matches). */
export function excerpt(text: string, query: string, max = EXCERPT_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const lower = t.toLowerCase();
  const at = tokenize(query).map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.min(Math.max(0, at - Math.floor(max / 4)), t.length - max);
  return (start > 0 ? "…" : "") + t.slice(start, start + max) + (start + max < t.length ? "…" : "");
}

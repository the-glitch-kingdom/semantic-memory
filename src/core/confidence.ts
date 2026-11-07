import { tokenize } from "./bm25.js";
import type { SearchResult } from "./types.js";

/** A top result under this is `no_strong_match`. Calibrated on the docs-vault eval (notes.md "Phase 7"). */
export const NO_STRONG_MATCH_BELOW = 0.5;
const LEXICAL_BONUS = 0.1;
export const EXCERPT_CHARS = 600;

/**
 * Confidence in 0..1 per result: its vector cosine, plus its margin over the best other result's cosine
 * (a lone strong hit scores above a crowd of similar ones), plus a bonus when BM25 also returned it
 * (two or more rare query terms in one chunk). Call on the whole ranked list, not a page of it.
 * Shortcut: the cross-encoder score is not folded in (it is off by default and has no calibration data).
 */
export function withConfidence<T extends Pick<SearchResult, "cosine" | "lexical">>(results: T[]): (T & { confidence: number })[] {
  const cos = results.map((r) => r.cosine ?? 0);
  return results.map((r, i) => {
    const other = Math.max(0, ...cos.filter((_, j) => j !== i));
    const raw = cos[i] + (cos[i] - other) + (r.lexical ? LEXICAL_BONUS : 0);
    return { ...r, confidence: Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100 };
  });
}

export const isWeak = (results: { confidence: number }[]): boolean => results.length > 0 && results[0].confidence < NO_STRONG_MATCH_BELOW;

/** `max` chars of `text` centred on the first query term it contains (the start when none matches). */
export function excerpt(text: string, query: string, max = EXCERPT_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const lower = t.toLowerCase();
  const at = tokenize(query).map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.min(Math.max(0, at - Math.floor(max / 4)), t.length - max);
  return (start > 0 ? "…" : "") + t.slice(start, start + max) + (start + max < t.length ? "…" : "");
}

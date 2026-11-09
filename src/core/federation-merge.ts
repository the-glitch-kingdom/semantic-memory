import { BM25_FRACTION, COSINE_WEIGHT } from "./bm25.js";
import type { SearchResult } from "./types.js";

/** One source's answer: its ranked list before fold (for the lexical arm) and its shaped page. */
export interface SourceRun {
  label: string;
  weight: number;
  bm25Min: number | null;
  ranked: SearchResult[];
  items: any[];
}

/** Per-item merge keys for one run, never rising down the page: each source keeps its own order. */
function keys(run: SourceRun): number[] {
  const selfTop = run.bm25Min === null ? null : run.bm25Min / BM25_FRACTION;
  const bm25Of = new Map(run.ranked.map((r) => [r.path, r.bm25 ?? 0]));
  const best = Math.max(0, ...bm25Of.values());
  let prev = Infinity;
  return run.items.map((it) => {
    let k = it.score as number;
    // swap the fusion's per-query lexical scale (best match in this query) for the source's corpus scale (capped at 1)
    if (selfTop && best > 0) k += (1 - COSINE_WEIGHT) * (Math.min(1, (bm25Of.get(it.path) ?? 0) / selfTop) - (bm25Of.get(it.path) ?? 0) / best);
    prev = Math.min(prev, k * run.weight);
    return prev;
  });
}

/**
 * Merge the pages of two or more sources into one: each item gets its `source`; pages are interleaved by BM25-calibrated (selfTop,
 * notes.md Phase 4) score times source weight with every source's own order kept. Per-query flags follow the whole answer: `no_strong_match` stays only when
 * every source with results is weak by its own bar, `related` and `query_type` only on the merged #1.
 */
export function mergeSources(runs: SourceRun[], limit: number): any[] {
  const lanes = runs.map((r) => ({ label: r.label, items: r.items, keys: keys(r), at: 0 }));
  const allWeak = runs.filter((r) => r.items.length).every((r) => r.items[0].no_strong_match);
  // a name is missing (or passing) only if every source with results lacks it: one source that has it answers for it
  const common = (k: "missing_terms" | "passing_terms") => {
    const sets = runs.filter((r) => r.items.length).map((r) => r.items[0][k] as string[] | undefined ?? []);
    const t = sets[0]?.filter((x) => sets.every((s) => s.includes(x))) ?? [];
    return t.length ? t : undefined;
  };
  const missing = common("missing_terms");
  const passing = common("passing_terms");
  const out: any[] = [];
  while (out.length < limit) {
    const lane = lanes.filter((l) => l.at < l.items.length).sort((a, b) => b.keys[b.at] - a.keys[a.at])[0];
    if (!lane) break;
    const { no_strong_match, missing_terms: _m, passing_terms: _p, undocumented, related, query_type, ...rest } = lane.items[lane.at++];
    out.push({
      ...rest,
      ...(out.length === 0 && { ...(query_type && { query_type }), ...(related && { related }) }),
      ...(allWeak && { ...(no_strong_match && { no_strong_match }), ...(missing && { missing_terms: missing }), ...(passing && { passing_terms: passing }), ...(undocumented && { undocumented }) }),
      source: lane.label,
    });
  }
  return out;
}

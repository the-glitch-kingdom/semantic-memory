/**
 * Golden retrieval eval harness (v1.4 Phase 1).
 *
 * The foundation the rest of the resident-expert arc is measured against: every
 * ranking or query-expansion change must show its delta here, not a vibe.
 *
 * This module is the pure metrics engine — it takes a set of (utterance →
 * expected paths) cases and a `search` function returning ranked paths, and
 * computes recall@k and MRR (overall and per case-class). It is decoupled from
 * the search stack so it can be unit-tested with a fake search and driven by the
 * real MCP server in the integration eval.
 */

export interface EvalCase {
  /** What the human typed. */
  utterance: string;
  /** Paths that SHOULD appear in the results (a hit = any one of them ranks in top-k). */
  expected: string[];
  /** Optional case-class for per-class breakdown (e.g. "terse", "conceptual"). */
  class?: string;
}

export interface CaseResult {
  utterance: string;
  klass: string;
  /** 1-based rank of the first expected path in the results, or null if none retrieved. */
  rankOfFirstExpected: number | null;
  hitAtK: Record<number, boolean>;
  reciprocalRank: number;
}

export interface ClassMetrics {
  n: number;
  recallAtK: Record<number, number>;
  mrr: number;
}

export interface EvalMetrics extends ClassMetrics {
  ks: number[];
  byClass: Record<string, ClassMetrics>;
  cases: CaseResult[];
}

/** Returns the ranked list of note paths for a query (best first). */
export type SearchFn = (query: string, limit: number) => Promise<string[]>;

export function parseGolden(text: string): EvalCase[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("#"))
    .map((l) => JSON.parse(l) as EvalCase);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export async function runEval(cases: EvalCase[], search: SearchFn, ks: number[] = [1, 3, 5]): Promise<EvalMetrics> {
  const maxK = Math.max(...ks);
  const results: CaseResult[] = [];

  for (const c of cases) {
    const ranked = await search(c.utterance, maxK);
    const expected = new Set(c.expected);
    let rank: number | null = null;
    for (let i = 0; i < ranked.length; i++) {
      if (expected.has(ranked[i])) {
        rank = i + 1;
        break;
      }
    }
    const hitAtK: Record<number, boolean> = {};
    for (const k of ks) hitAtK[k] = rank !== null && rank <= k;
    results.push({
      utterance: c.utterance,
      klass: c.class ?? "default",
      rankOfFirstExpected: rank,
      hitAtK,
      reciprocalRank: rank ? 1 / rank : 0,
    });
  }

  const aggregate = (rs: CaseResult[]): ClassMetrics => ({
    n: rs.length,
    recallAtK: Object.fromEntries(ks.map((k) => [k, mean(rs.map((r) => (r.hitAtK[k] ? 1 : 0)))])),
    mrr: mean(rs.map((r) => r.reciprocalRank)),
  });

  const byClass: Record<string, ClassMetrics> = {};
  for (const klass of new Set(results.map((r) => r.klass))) {
    byClass[klass] = aggregate(results.filter((r) => r.klass === klass));
  }

  return { ks, ...aggregate(results), byClass, cases: results };
}

export function formatReport(m: EvalMetrics): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const lines: string[] = [];
  lines.push(`Retrieval eval — ${m.n} cases`);
  lines.push(`  overall:  ${m.ks.map((k) => `recall@${k}=${pct(m.recallAtK[k])}`).join("  ")}  MRR=${m.mrr.toFixed(3)}`);
  for (const [klass, cm] of Object.entries(m.byClass).sort()) {
    lines.push(`  ${klass.padEnd(12)} (${cm.n}): ${m.ks.map((k) => `recall@${k}=${pct(cm.recallAtK[k])}`).join("  ")}  MRR=${cm.mrr.toFixed(3)}`);
  }
  const misses = m.cases.filter((c) => c.rankOfFirstExpected === null);
  if (misses.length) {
    lines.push(`  complete misses (${misses.length}):`);
    for (const c of misses) lines.push(`    ✗ [${c.klass}] "${c.utterance}"`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Facet eval (retrieval-graph-quality Phase 2): answer-facet scoring, negatives,
// archive hits, payload size, and graph link precision/recall.
// ---------------------------------------------------------------------------

export interface FacetCase {
  id: string;
  tier: "exact" | "paraphrase" | "multi" | "negative";
  q: string;
  /** Regexes (case-insensitive). The case is answered at k when every one matches the text of some non-archive result in the top k. */
  facets?: string[];
}

export interface ArmResponse {
  results: { path: string; score: number }[];
  /** Size of the tool response, in bytes. */
  bytes: number;
}
export type ArmFn = (q: string, limit: number) => Promise<ArmResponse>;

export const ARCHIVE_RE = /(^|\/)archive\//;
export const FACET_KS = [1, 3, 8];

export interface ArmMetrics {
  /** answered counts out of `n` answerable cases, per tier and overall: { tier: { n, at: { "1": count, ... } } } */
  tiers: Record<string, { n: number; at: Record<number, number> }>;
  /** Top score of each negative case (null when the arm returned nothing). */
  negativeTop: (number | null)[];
  /** Results under an archive/ folder across the top 8 of every case, negatives included. */
  archiveHits: number;
  meanBytes: number;
}

/** Rank (1-based) at which the facets are first all covered by live (non-archive) results, or null. */
export function facetRank(facets: string[], paths: string[], textOf: (p: string) => string): number | null {
  const res = facets.map((f) => new RegExp(f, "i"));
  for (let k = 1; k <= paths.length; k++) {
    const live = paths.slice(0, k).filter((p) => !ARCHIVE_RE.test(p));
    if (res.every((re) => live.some((p) => re.test(textOf(p))))) return k;
  }
  return null;
}

export async function runFacetEval(cases: FacetCase[], arm: ArmFn, textOf: (p: string) => string): Promise<ArmMetrics> {
  const maxK = Math.max(...FACET_KS);
  const tiers: ArmMetrics["tiers"] = {};
  const negativeTop: (number | null)[] = [];
  let archiveHits = 0;
  let bytes = 0;
  for (const c of cases) {
    const { results, bytes: b } = await arm(c.q, maxK);
    const top = results.slice(0, maxK);
    bytes += b;
    archiveHits += top.filter((r) => ARCHIVE_RE.test(r.path)).length;
    if (c.tier === "negative") {
      negativeTop.push(top.length ? top[0].score : null);
      continue;
    }
    const rank = facetRank(c.facets ?? [], top.map((r) => r.path), textOf);
    for (const key of [c.tier, "all"]) {
      const t = (tiers[key] ??= { n: 0, at: Object.fromEntries(FACET_KS.map((k) => [k, 0])) });
      t.n++;
      for (const k of FACET_KS) if (rank !== null && rank <= k) t.at[k]++;
    }
  }
  return { tiers, negativeTop, archiveHits, meanBytes: Math.round(bytes / cases.length) };
}

export interface LinkMetrics {
  precision: number;
  recall: number;
}

/** Micro-averaged precision/recall of a link tool against `truth` (doc -> expected paths), over the docs in `truth`. */
export async function scoreLinks(truth: Record<string, string[]>, links: (path: string) => Promise<string[]>): Promise<LinkMetrics> {
  let tp = 0;
  let returned = 0;
  let expected = 0;
  for (const [doc, want] of Object.entries(truth)) {
    const got = new Set(await links(doc));
    returned += got.size;
    expected += want.length;
    tp += want.filter((p) => got.has(p)).length;
  }
  return { precision: returned ? tp / returned : 1, recall: expected ? tp / expected : 1 };
}

export function invertLinks(forward: Record<string, string[]>): Record<string, string[]> {
  const inv: Record<string, string[]> = Object.fromEntries(Object.keys(forward).map((p) => [p, []]));
  for (const [from, tos] of Object.entries(forward)) for (const to of tos) (inv[to] ??= []).push(from);
  return inv;
}

export function formatArm(name: string, m: ArmMetrics): string {
  const lines = [`  ${name}  archive-hits=${m.archiveHits}  mean-payload=${m.meanBytes}B  negative-top=[${m.negativeTop.map((s) => (s === null ? "-" : s.toFixed(2))).join(" ")}]`];
  for (const [tier, t] of Object.entries(m.tiers).sort()) {
    lines.push(`    ${tier.padEnd(11)} (${String(t.n).padStart(2)}): ${FACET_KS.map((k) => `@${k}=${t.at[k]}/${t.n}`).join("  ")}`);
  }
  return lines.join("\n");
}

/**
 * Retrieval eval engine (v1.4 Phase 1; moved into src for the built-in eval, v1.13).
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
  tier: "exact" | "paraphrase" | "symptom" | "nofield" | "multi" | "negative";
  q: string;
  /** Hand-labelled by reading the question (not copied from the tier): what a query classifier should say. */
  qtype?: "identifier" | "fact" | "flow";
  /** Regexes (case-insensitive). The case is answered at k when every one matches the text of some non-archive result in the top k. */
  facets?: string[];
  /** Expected doc paths: when set, found@k and MRR are reported too (a hit = any one of them ranks in top-k). */
  expected?: string[];
  /** Held-out questions are never used to choose constants, rules or thresholds. */
  split?: "tune" | "heldout";
  /** What a negative asks for: a term no doc contains, or a topic the corpus does not cover. */
  negative_kind?: "identifier" | "topic";
}

export interface ArmResponse {
  results: { path: string; score: number }[];
  /** Size of the tool response, in bytes. */
  bytes: number;
  /** The response carried `no_strong_match`. */
  weak?: boolean;
  /** paths of the `related` neighbours attached to the #1 result (context expansion) */
  related?: string[];
  /** the `decay` block of each result that carried one, by path (`source` is the age source: last_verified / git / mtime / penalty / fresh) */
  decay?: Record<string, { multiplier: number; source?: string }>;
}
export type ArmFn = (q: string, limit: number) => Promise<ArmResponse>;

export const ARCHIVE_RE = /(^|\/)archive\//;
export const FACET_KS = [1, 3, 8];

export interface ArmMetrics {
  /** answered counts out of `n` answerable cases, per tier and overall: { tier: { n, at: { "1": count, ... } } } */
  tiers: Record<string, { n: number; at: Record<number, number>; /** answered by the #1 result plus its `related` neighbours */ expandedAt1: number }>;
  /** Top score of each negative case (null when the arm returned nothing). */
  negativeTop: (number | null)[];
  /** Results under an archive/ folder across the top 8 of every case, negatives included. */
  archiveHits: number;
  meanBytes: number;
  /** Negative cases whose response carried no_strong_match, out of negativeTop.length. */
  negativesFlagged: number;
  /** Cases answered at @1 whose response carried no_strong_match (the cost of abstaining). */
  answeredFlagged: number;
  /** Answerable cases (any rank) whose response carried no_strong_match, out of the answerable total. */
  answerableFlagged: number;
  /** Cases with `expected`: found@k out of `expectedN`, and MRR over them. */
  expectedN: number;
  foundAt: Record<number, number>;
  mrr: number;
  /** Per-call latency in ms across all cases. */
  latencyMs: { p50: number; p95: number };
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

const percentile = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);

export async function runFacetEval(cases: FacetCase[], arm: ArmFn, textOf: (p: string) => string): Promise<ArmMetrics> {
  const maxK = Math.max(...FACET_KS);
  const tiers: ArmMetrics["tiers"] = {};
  const negativeTop: (number | null)[] = [];
  let archiveHits = 0;
  let bytes = 0;
  let negativesFlagged = 0;
  let answeredFlagged = 0;
  let answerableFlagged = 0;
  const latencies: number[] = [];
  let expectedN = 0;
  const foundAt: Record<number, number> = Object.fromEntries(FACET_KS.map((k) => [k, 0]));
  let rrSum = 0;
  for (const c of cases) {
    const t0 = performance.now();
    const { results, bytes: b, weak, related } = await arm(c.q, maxK);
    latencies.push(performance.now() - t0);
    const top = results.slice(0, maxK);
    bytes += b;
    archiveHits += top.filter((r) => ARCHIVE_RE.test(r.path)).length;
    if (c.tier === "negative") {
      negativeTop.push(top.length ? top[0].score : null);
      if (weak) negativesFlagged++;
      continue;
    }
    if (c.expected) {
      const at = top.findIndex((r) => c.expected!.includes(r.path)) + 1;
      expectedN++;
      for (const k of FACET_KS) if (at && at <= k) foundAt[k]++;
      if (at) rrSum += 1 / at;
    }
    const rank = facetRank(c.facets ?? [], top.map((r) => r.path), textOf);
    if (weak) answerableFlagged++;
    if (weak && rank === 1) answeredFlagged++;
    const expanded = top.length > 0 && facetRank(c.facets ?? [], [top[0].path, ...(related ?? [])], textOf) !== null;
    for (const key of [c.tier, "all"]) {
      const t = (tiers[key] ??= { n: 0, at: Object.fromEntries(FACET_KS.map((k) => [k, 0])), expandedAt1: 0 });
      t.n++;
      if (expanded) t.expandedAt1++;
      for (const k of FACET_KS) if (rank !== null && rank <= k) t.at[k]++;
    }
  }
  return { tiers, negativeTop, archiveHits, meanBytes: Math.round(bytes / cases.length), negativesFlagged, answeredFlagged, answerableFlagged, expectedN, foundAt, mrr: expectedN ? rrSum / expectedN : 0, latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) } };
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
  const lines = [`  ${name}  archive-hits=${m.archiveHits}  mean-payload=${m.meanBytes}B  flagged: negatives ${m.negativesFlagged}/${m.negativeTop.length}, answered@1 ${m.answeredFlagged}, answerable ${m.answerableFlagged}  negative-top=[${m.negativeTop.map((s) => (s === null ? "-" : s.toFixed(2))).join(" ")}]`];
  for (const [tier, t] of Object.entries(m.tiers).sort()) {
    lines.push(`    ${tier.padEnd(11)} (${String(t.n).padStart(2)}): ${FACET_KS.map((k) => `@${k}=${t.at[k]}/${t.n}`).join("  ")}  #1+related=${t.expandedAt1}/${t.n}`);
  }
  return lines.join("\n");
}

const STOP = new Set("the a an of to for and or in on is are do does how what which when where who with from that this it we our can i my be".split(" "));

/** The "grep" arm's pattern: every content word of the question as one alternation, for search_text with regex on. */
export function grepPattern(q: string): string {
  return (q.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).join("|");
}

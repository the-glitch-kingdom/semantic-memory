// The report's Targets and Diagnosis sections (#96): computed from what runSuite already measured, appended after today's lines.
import { normalizeVerifiedDate } from "../decay.js";
import matter from "../matter.js";
import type { ArmReport, EvalReport } from "./suite.js";
import { facetIssue, type ArmMetrics, type FacetCase } from "./metrics.js";
import type { Targets } from "./targets.js";

/** hit-em-with-the-docs 3.4 `vault.audit_window_days` default: a doc is verified when its `last_verified` is this recent (or its grounding verdict is `verified`). */
const VERIFIED_WINDOW_DAYS = 90;
/** Per result path, what the response carried for the top-3 grounding metrics: its review verdict and dead file refs. */
export type Ground = Record<string, { verdict?: string; dead: number }>;

export interface TargetRow { metric: string; value: number | null; valueBlind: number | null; target: number | null; met: boolean | null | "not validated" }
export interface TargetsReport { rows: TargetRow[]; validated: boolean; blindCases: number; noise: number | null }
export type Label = "coverage" | "ranking" | "grounding";
export interface DiagCase { id: string; q: string; label: Label; why: string; grepAt8?: boolean }
export interface Diagnosis { cases: DiagCase[]; counts: Record<Label, number>; grep: { at1: number; at3: number; n: number } }

/** Whether a doc counts as verified: a `verified` verdict, or `last_verified` inside the window (a date in the future is not). */
export function isVerified(text: string, verdict: string | undefined, now = Date.now()): boolean {
  if (verdict === "verified") return true;
  let t = NaN;
  try { t = Date.parse(normalizeVerifiedDate(matter(text).data.last_verified) ?? ""); } catch { /* unparseable frontmatter: not verified */ }
  return t <= now && now - t <= VERIFIED_WINDOW_DAYS * 86_400_000;
}

/** Shares of the top-3 slots of the answerable cases that are verified / carry no dead ref; null with no slots. */
export function top3Shares(cases: FacetCase[], top3: Record<string, string[]>, ground: Record<string, Ground>, textOf: (p: string) => string) {
  let slots = 0, verified = 0, clean = 0;
  for (const c of cases) {
    if (c.tier === "negative") continue;
    for (const p of top3[c.q] ?? []) {
      const g = ground[c.q]?.[p];
      slots++;
      if (isVerified(textOf(p), g?.verdict)) verified++;
      if (!g?.dead) clean++;
    }
  }
  return { verified: slots ? verified / slots : null, noRefs: slots ? clean / slots : null };
}

const rate = (n: number, d: number) => (d ? n / d : null);
const measures = (m: ArmMetrics, s: ReturnType<typeof top3Shares>, p95: number): Record<string, number | null> => {
  const t = m.tiers, all = t.all, at = (tier: string, k: number) => (t[tier] ? rate(t[tier].at[k], t[tier].n) : null);
  return {
    hybrid_at1: at("all", 1), hybrid_at3: at("all", 3), exact_at1: at("exact", 1), paraphrase_at1: at("paraphrase", 1),
    related_at1: all ? rate(all.expandedAt1, all.n) : null, verified_top3: s.verified, no_missing_refs_top3: s.noRefs,
    negatives_flagged: rate(m.negativesFlagged, m.negativeTop.length), false_flags: all ? rate(m.answerableFlagged, all.n) : null, p95_ms: p95,
  };
};
const MAX_METRICS = new Set(["false_flags", "p95_ms"]);
const round = (v: number | null) => (v === null ? null : +v.toFixed(4));

/** Met is judged on the blind subset only; with no blind case every cell is `not validated`. A null target or an unmeasured value is not judged. */
export function judgeTargets(targets: Targets, all: ArmMetrics, allShares: ReturnType<typeof top3Shares>, blind: { m: ArmMetrics; shares: ReturnType<typeof top3Shares>; n: number } | null | undefined): TargetsReport {
  const p95 = all.latencyMs.p95; // replayed arms carry no latency of their own, so p95 is the run's
  const a = measures(all, allShares, p95), b = blind ? measures(blind.m, blind.shares, p95) : null;
  const rows = Object.entries(targets).map(([metric, { value: target }]): TargetRow => {
    const v = b?.[metric] ?? null;
    const met = !b ? "not validated" : target === null || v === null ? null : MAX_METRICS.has(metric) ? v <= target : v >= target;
    return { metric, value: round(a[metric] ?? null), valueBlind: round(v), target, met };
  });
  return { rows, validated: !!blind, blindCases: blind?.n ?? 0, noise: all.tiers.all ? 1 / all.tiers.all.n : null };
}

/** Labels each answerable hybrid miss: coverage (a facet no doc has), ranking (the docs have it, search did not put it first), grounding (answered, but on an unverified or dead-ref doc). */
export function diagnose(live: FacetCase[], docs: Map<string, string>, hybrid: ArmReport, grep: ArmReport, top3: Record<string, string[]>, ground: Record<string, Ground>): Diagnosis {
  const cases: DiagCase[] = [];
  for (const c of live) {
    if (c.tier === "negative") continue;
    const out = hybrid.outcomes[c.id];
    const base = { id: c.id, q: c.q };
    const gap = facetIssue(c, docs);
    if (out !== 1) {
      if (gap?.unmatched) cases.push({ ...base, label: "coverage", why: gap.why });
      else cases.push({ ...base, label: "ranking", why: out ? `answered at ${out}, not at 1` : "not in the top 8", grepAt8: grep.outcomes[c.id] !== 0 });
      continue;
    }
    const answering = (top3[c.q] ?? []).filter((p) => (c.facets ?? []).some((f) => new RegExp(f, "i").test(docs.get(p) ?? "")));
    const bad = answering.flatMap((p) => {
      const g = ground[c.q]?.[p];
      return g?.dead ? [`${p} cites a missing ref`] : isVerified(docs.get(p) ?? "", g?.verdict) ? [] : [`${p} is unverified`];
    });
    if (bad.length) cases.push({ ...base, label: "grounding", why: bad.join("; ") });
  }
  const counts = { coverage: 0, ranking: 0, grounding: 0 };
  for (const c of cases) counts[c.label]++;
  const g = grep.all.tiers.all;
  return { cases, counts, grep: { at1: g?.at[1] ?? 0, at3: g?.at[3] ?? 0, n: g?.n ?? 0 } };
}

const fmt = (metric: string, v: number | null) => (v === null ? "-" : metric === "p95_ms" ? `${Math.round(v)}ms` : v.toFixed(2));
const metCell = (m: TargetRow["met"]) => (m === "not validated" ? m : m === null ? "-" : m ? "yes" : "no");

/** Lines appended after today's report. */
export function formatSections(r: Pick<EvalReport, "targets" | "diagnosis">): string[] {
  const lines: string[] = [];
  const t = r.targets;
  if (t) {
    lines.push("", `Targets${t.validated ? ` (met is judged on ${t.blindCases} blind cases)` : ""}`, `  ${"metric".padEnd(22)}${"all".padStart(7)}${"blind".padStart(8)}${"target".padStart(8)}  met`);
    for (const x of t.rows) lines.push(`  ${x.metric.padEnd(22)}${fmt(x.metric, x.value).padStart(7)}${fmt(x.metric, x.valueBlind).padStart(8)}${fmt(x.metric, x.target).padStart(8)}  ${metCell(x.met)}`);
    if (t.noise !== null) lines.push(`  noise: 1/n = ${t.noise.toFixed(3)} (a change of one question is not a signal)`);
    if (!t.validated) lines.push("  not validated: no blind set (mark a set blind: true, see BLIND-SETS.md)");
  }
  const d = r.diagnosis;
  if (d) {
    lines.push("", "Diagnosis", `  coverage ${d.counts.coverage}, ranking ${d.counts.ranking}, grounding ${d.counts.grounding}`);
    for (const c of d.cases) lines.push(`  ${c.id}: ${c.label}, ${c.why}${c.grepAt8 === undefined ? "" : c.grepAt8 ? " (grep finds it at 8)" : " (grep misses it too)"}`);
    lines.push(`  grep oracle: @1 ${d.grep.at1}/${d.grep.n}, @3 ${d.grep.at3}/${d.grep.n}`);
  }
  return lines;
}

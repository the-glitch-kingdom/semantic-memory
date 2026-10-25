/**
 * Failure-lookup eval (v1.6): given failed tool calls, the hits a search returned for each, and human
 * (or judge) relevance labels, measure how well the top hit answers the failure and pick the score
 * threshold above which injecting it is right often enough. Pure — no I/O, no search.
 */

export interface FailureCase {
  id: string;
  /** notes folder this failure's repo searches (its docs) */
  notes: string;
  error: string;
  command: string;
}

export interface Judgment {
  case: string;
  path: string;
  relevant: boolean;
}

export interface CaseResult {
  case: string;
  hits: { path: string; score: number }[];
}

export interface ThresholdRow {
  threshold: number;
  /** cases whose top hit scored >= threshold (would be injected) */
  injected: number;
  /** injected cases whose top hit has a label */
  judged: number;
  correct: number;
  /** correct / judged; null when nothing judged */
  precision: number | null;
  /** injected / all cases */
  coverage: number;
}

export interface FailureEvalReport {
  cases: number;
  /** cases with at least one relevant path among their labels */
  answerable: number;
  /** answerable cases whose top hit is relevant */
  rank1: number;
  /** answerable cases with a relevant path anywhere in the hits */
  recallAtK: number;
  rows: ThresholdRow[];
  /** lowest threshold reaching the target precision on >= minJudged judged injections; null if none */
  recommended: number | null;
  /** top hits nobody has labelled yet: label these, then re-run */
  unjudged: { case: string; path: string; score: number }[];
}

const key = (c: string, p: string) => `${c}\u0000${p}`;

export function evaluateFailures(
  results: CaseResult[],
  judgments: Judgment[],
  opts: { targetPrecision?: number; minJudged?: number; thresholds?: number[] } = {}
): FailureEvalReport {
  const target = opts.targetPrecision ?? 0.95;
  const minJudged = opts.minJudged ?? 20;
  const thresholds = opts.thresholds ?? Array.from({ length: 17 }, (_, i) => Math.round((0.2 + i * 0.05) * 100) / 100);

  const label = new Map<string, boolean>();
  const relevantFor = new Map<string, Set<string>>();
  for (const j of judgments) {
    // a positive label wins over a negative one for the same pair
    label.set(key(j.case, j.path), (label.get(key(j.case, j.path)) ?? false) || j.relevant);
    if (j.relevant) {
      if (!relevantFor.has(j.case)) relevantFor.set(j.case, new Set());
      relevantFor.get(j.case)!.add(j.path);
    }
  }

  let answerable = 0, rank1 = 0, recallAtK = 0;
  const unjudged: FailureEvalReport["unjudged"] = [];
  for (const r of results) {
    const relevant = relevantFor.get(r.case);
    if (relevant && relevant.size > 0) {
      answerable++;
      if (r.hits[0] && relevant.has(r.hits[0].path)) rank1++;
      if (r.hits.some((h) => relevant.has(h.path))) recallAtK++;
    }
    const top = r.hits[0];
    if (top && !label.has(key(r.case, top.path))) unjudged.push({ case: r.case, path: top.path, score: top.score });
  }

  const rows: ThresholdRow[] = thresholds.map((threshold) => {
    let injected = 0, judged = 0, correct = 0;
    for (const r of results) {
      const top = r.hits[0];
      if (!top || top.score < threshold) continue;
      injected++;
      const l = label.get(key(r.case, top.path));
      if (l === undefined) continue;
      judged++;
      if (l) correct++;
    }
    return {
      threshold,
      injected,
      judged,
      correct,
      precision: judged > 0 ? correct / judged : null,
      coverage: results.length > 0 ? injected / results.length : 0,
    };
  });

  // lowest threshold where this row and every higher row with enough judged injections reach the target
  const meets = (row: ThresholdRow) => row.precision !== null && row.precision >= target;
  const recommended =
    rows.find(
      (row, i) => row.judged >= minJudged && meets(row) && rows.slice(i + 1).every((r) => r.judged < minJudged || meets(r))
    )?.threshold ?? null;

  return { cases: results.length, answerable, rank1, recallAtK, rows, recommended, unjudged };
}

export function formatFailureEval(report: FailureEvalReport, label = ""): string {
  const pct = (n: number | null) => (n === null ? "  -  " : `${(n * 100).toFixed(1)}%`.padStart(6));
  const lines = [
    `Failure-lookup eval${label ? ` (${label})` : ""} — ${report.cases} cases, ${report.answerable} with a known answer`,
    `  answer ranked first: ${report.rank1}/${report.answerable}   answer anywhere in hits: ${report.recallAtK}/${report.answerable}`,
    "",
    "  threshold  injected  judged  correct  precision  coverage",
  ];
  for (const r of report.rows) {
    lines.push(
      `  ${r.threshold.toFixed(2).padStart(9)}  ${String(r.injected).padStart(8)}  ${String(r.judged).padStart(6)}  ${String(r.correct).padStart(7)}  ${pct(r.precision).padStart(9)}  ${pct(r.coverage).padStart(8)}`
    );
  }
  lines.push("");
  lines.push(
    report.recommended === null
      ? "  recommended threshold: none reaches the target precision with enough judged injections"
      : `  recommended threshold: ${report.recommended.toFixed(2)}`
  );
  lines.push(`  unjudged top hits: ${report.unjudged.length}`);
  return lines.join("\n");
}

// --- v1.7 jev mode: the judge's agreement with labels, and the failure hook's Jev gate ---

/** jev-loop's adoption bar: right >= 95% of the time over >= 40 picks, with at most 2 wrong. */
export const meetsBar = (picks: number, wrong: number) => picks >= 40 && wrong <= 2 && (picks - wrong) / picks >= 0.95;

export interface JevJudgment {
  case: string;
  path: string;
  p: number | null;
}

export interface JudgeCalibration {
  /** labelled pairs Jev answered */
  pairs: number;
  /** label relevant / not relevant: picks Jev made (>= bar yes, <= 1-bar no), how many disagree, unsure */
  relevant: { pairs: number; yes: number; no: number; unsure: number };
  notRelevant: { pairs: number; yes: number; no: number; unsure: number };
  /** every pick (yes or no): agreement with the labels */
  picks: number;
  wrong: number;
  agreement: number | null;
  unsureRate: number;
  /** yes picks alone (the side that would inject) */
  yesPicks: number;
  yesWrong: number;
  /** "jev": Jev alone may judge (meets the bar on all picks); "hybrid": Jev's picks, unsure pairs to Claude */
  verdict: "jev" | "hybrid";
}

export function calibrateJudge(labels: Judgment[], jev: JevJudgment[], bar = 0.95): JudgeCalibration {
  const label = new Map<string, boolean>();
  for (const j of labels) label.set(key(j.case, j.path), (label.get(key(j.case, j.path)) ?? false) || j.relevant);
  const relevant = { pairs: 0, yes: 0, no: 0, unsure: 0 };
  const notRelevant = { pairs: 0, yes: 0, no: 0, unsure: 0 };
  const seen = new Set<string>();
  for (const r of jev) {
    const k = key(r.case, r.path);
    const l = label.get(k);
    if (l === undefined || seen.has(k)) continue;
    seen.add(k);
    const side = l ? relevant : notRelevant;
    side.pairs++;
    if (r.p !== null && r.p >= bar) side.yes++;
    else if (r.p !== null && r.p <= 1 - bar + 1e-9) side.no++;
    else side.unsure++;
  }
  const pairs = relevant.pairs + notRelevant.pairs;
  const picks = relevant.yes + relevant.no + notRelevant.yes + notRelevant.no;
  const wrong = relevant.no + notRelevant.yes;
  return {
    pairs,
    relevant,
    notRelevant,
    picks,
    wrong,
    agreement: picks ? (picks - wrong) / picks : null,
    unsureRate: pairs ? (relevant.unsure + notRelevant.unsure) / pairs : 0,
    yesPicks: relevant.yes + notRelevant.yes,
    yesWrong: notRelevant.yes,
    verdict: meetsBar(picks, wrong) ? "jev" : "hybrid",
  };
}

export interface GateRow {
  threshold: number;
  /** cases with a candidate fact (first fact in the top hits scoring >= threshold) */
  candidates: number;
  /** candidates Jev has not answered yet (ask, then re-run) */
  missing: number;
  /** candidates Jev said yes to at >= the bar: would be injected */
  injected: number;
  judged: number;
  correct: number;
  precision: number | null;
  coverage: number;
  meetsBar: boolean;
}

/**
 * The failure hook's Jev gate, replayed: per threshold T, the candidate is the first fact among the top
 * `topK` hits scoring >= T; it is injected only when Jev scores it >= the bar. Precision is measured on
 * the injected candidates that carry a label.
 */
export function evaluateGate(
  results: CaseResult[],
  judgments: Judgment[],
  jev: JevJudgment[],
  opts: { thresholds?: number[]; topK?: number; bar?: number; isCandidate?: (path: string) => boolean } = {},
): { rows: GateRow[]; missing: { case: string; path: string }[] } {
  const thresholds = opts.thresholds ?? [0.3, 0.35, 0.4, 0.5];
  const topK = opts.topK ?? 5;
  const bar = opts.bar ?? 0.95;
  const isCandidate = opts.isCandidate ?? ((p: string) => /(^|\/)facts\/[^/]+\.md$/.test(p));
  const label = new Map<string, boolean>();
  for (const j of judgments) label.set(key(j.case, j.path), (label.get(key(j.case, j.path)) ?? false) || j.relevant);
  const score = new Map<string, number | null>();
  for (const r of jev) score.set(key(r.case, r.path), r.p);
  const missing = new Map<string, { case: string; path: string }>();
  const rows = thresholds.map((threshold) => {
    let candidates = 0, miss = 0, injected = 0, judged = 0, correct = 0;
    for (const r of results) {
      const hit = r.hits.slice(0, topK).find((h) => isCandidate(h.path) && h.score >= threshold);
      if (!hit) continue;
      candidates++;
      const k = key(r.case, hit.path);
      if (!score.has(k)) {
        miss++;
        missing.set(k, { case: r.case, path: hit.path });
        continue;
      }
      const p = score.get(k);
      if (p === null || p === undefined || p < bar) continue;
      injected++;
      const l = label.get(k);
      if (l === undefined) continue;
      judged++;
      if (l) correct++;
    }
    return {
      threshold,
      candidates,
      missing: miss,
      injected,
      judged,
      correct,
      precision: judged ? correct / judged : null,
      coverage: results.length ? injected / results.length : 0,
      meetsBar: meetsBar(judged, judged - correct),
    };
  });
  return { rows, missing: [...missing.values()] };
}

export function formatGate(rows: GateRow[]): string {
  const pct = (n: number | null) => (n === null ? "  -  " : `${(n * 100).toFixed(1)}%`);
  const lines = ["Jev gate (inject the first fact >= T only when Jev says yes at >= 0.95)", "", "     T  candidates  missing  injected  judged  correct  precision  coverage  bar"];
  for (const r of rows) {
    lines.push(
      `  ${r.threshold.toFixed(2)}  ${String(r.candidates).padStart(10)}  ${String(r.missing).padStart(7)}  ${String(r.injected).padStart(8)}  ${String(r.judged).padStart(6)}  ${String(r.correct).padStart(7)}  ${pct(r.precision).padStart(9)}  ${pct(r.coverage).padStart(8)}  ${r.meetsBar ? "yes" : "no"}`,
    );
  }
  return lines.join("\n");
}

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

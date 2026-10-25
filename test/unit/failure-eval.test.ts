import { describe, it, expect } from "vitest";
import { evaluateFailures, formatFailureEval, calibrateJudge, evaluateGate, meetsBar } from "../../src/core/failure-eval.js";

const hit = (path: string, score: number) => ({ path, score });

describe("evaluateFailures", () => {
  const results = [
    { case: "c1", hits: [hit("facts/a.md", 0.9), hit("facts/b.md", 0.5)] }, // right, high score
    { case: "c2", hits: [hit("facts/x.md", 0.6), hit("facts/b.md", 0.4)] }, // wrong top, answer second
    { case: "c3", hits: [hit("facts/c.md", 0.3)] }, // right but low score
    { case: "c4", hits: [hit("facts/z.md", 0.85)] }, // no answer exists; top hit unlabelled
    { case: "c5", hits: [] },
  ];
  const judgments = [
    { case: "c1", path: "facts/a.md", relevant: true },
    { case: "c2", path: "facts/b.md", relevant: true },
    { case: "c2", path: "facts/x.md", relevant: false },
    { case: "c3", path: "facts/c.md", relevant: true },
  ];

  it("counts rank-1 and recall over cases with a known answer", () => {
    const r = evaluateFailures(results, judgments);
    expect(r.cases).toBe(5);
    expect(r.answerable).toBe(3);
    expect(r.rank1).toBe(2); // c1, c3
    expect(r.recallAtK).toBe(3); // c2's answer is second
  });

  it("computes precision and coverage per threshold from judged top hits only", () => {
    const r = evaluateFailures(results, judgments, { thresholds: [0.25, 0.5, 0.8] });
    const at = (t: number) => r.rows.find((row) => row.threshold === t)!;
    expect(at(0.25)).toMatchObject({ injected: 4, judged: 3, correct: 2, coverage: 0.8 });
    expect(at(0.25).precision).toBeCloseTo(2 / 3);
    expect(at(0.5)).toMatchObject({ injected: 3, judged: 2, correct: 1 }); // c1 right, c2 wrong; c4 unjudged
    expect(at(0.8)).toMatchObject({ injected: 2, judged: 1, correct: 1, precision: 1 });
  });

  it("lists unlabelled top hits for labelling", () => {
    expect(evaluateFailures(results, judgments).unjudged).toEqual([{ case: "c4", path: "facts/z.md", score: 0.85 }]);
  });

  it("recommends the lowest threshold whose precision holds from there up, with enough judged injections", () => {
    const r = evaluateFailures(results, judgments, { thresholds: [0.25, 0.5, 0.8], minJudged: 1 });
    expect(r.recommended).toBe(0.8);
    expect(evaluateFailures(results, judgments, { thresholds: [0.25, 0.5, 0.8], minJudged: 5 }).recommended).toBeNull();
  });

  it("does not recommend a threshold when a higher one drops below the target", () => {
    const res = [
      { case: "a", hits: [hit("p", 0.5)] },
      { case: "b", hits: [hit("q", 0.9)] },
    ];
    const j = [
      { case: "a", path: "p", relevant: true },
      { case: "b", path: "q", relevant: false },
    ];
    // at 0.4: 1/2; at 0.6: 0/1 — nothing holds
    expect(evaluateFailures(res, j, { thresholds: [0.4, 0.6], minJudged: 1, targetPrecision: 0.5 }).recommended).toBeNull();
  });

  it("a positive label wins over a negative one for the same pair", () => {
    const r = evaluateFailures(
      [{ case: "c", hits: [hit("p", 0.9)] }],
      [
        { case: "c", path: "p", relevant: false },
        { case: "c", path: "p", relevant: true },
      ],
      { thresholds: [0.5] }
    );
    expect(r.rows[0]).toMatchObject({ judged: 1, correct: 1 });
  });

  it("formats a readable table", () => {
    const text = formatFailureEval(evaluateFailures(results, judgments, { thresholds: [0.5] }), "baseline");
    expect(text).toContain("baseline");
    expect(text).toContain("answer ranked first: 2/3");
    expect(text).toContain("unjudged top hits: 1");
  });
});

// v1.7 jev mode
describe("meetsBar", () => {
  it("needs >= 40 picks, <= 2 wrong and >= 95% right", () => {
    expect(meetsBar(40, 2)).toBe(true);
    expect(meetsBar(39, 0)).toBe(false);
    expect(meetsBar(100, 3)).toBe(false);
    expect(meetsBar(40, 0)).toBe(true);
  });
});

describe("calibrateJudge", () => {
  const labels = Array.from({ length: 50 }, (_, i) => ({ case: `c${i}`, path: "f.md", relevant: i < 5 }));
  it("counts picks per label class, wrong picks and unsure", () => {
    const jev = labels.map((l, i) => ({ case: l.case, path: l.path, p: l.relevant ? 0.97 : i === 10 ? 0.5 : 0.01 }));
    const c = calibrateJudge(labels, jev);
    expect(c.relevant).toEqual({ pairs: 5, yes: 5, no: 0, unsure: 0 });
    expect(c.notRelevant).toEqual({ pairs: 45, yes: 0, no: 44, unsure: 1 });
    expect([c.picks, c.wrong, c.unsureRate]).toEqual([49, 0, 1 / 50]);
    expect(c.verdict).toBe("jev");
  });
  it("is hybrid when Jev is wrong too often, and ignores unlabelled pairs", () => {
    const jev = labels.map((l) => ({ case: l.case, path: l.path, p: l.relevant ? 0.01 : 0.97 })).concat([{ case: "x", path: "y", p: 0.99 }]);
    const c = calibrateJudge(labels, jev);
    expect(c.pairs).toBe(50);
    expect(c.wrong).toBe(50);
    expect(c.yesWrong).toBe(45);
    expect(c.verdict).toBe("hybrid");
  });
});

describe("evaluateGate", () => {
  const results = [
    { case: "a", hits: [{ path: "guides/g.md", score: 0.9 }, { path: "facts/a.md", score: 0.45 }] },
    { case: "b", hits: [{ path: "facts/b.md", score: 0.32 }] },
    { case: "c", hits: [{ path: "facts/c.md", score: 0.6 }] },
    { case: "d", hits: [] },
  ];
  const judgments = [
    { case: "a", path: "facts/a.md", relevant: true },
    { case: "b", path: "facts/b.md", relevant: false },
  ];
  it("candidate = first fact >= T; inject only at Jev >= 0.95; precision on labelled injections", () => {
    const jev = [
      { case: "a", path: "facts/a.md", p: 0.99 },
      { case: "b", path: "facts/b.md", p: 0.96 },
    ];
    const { rows, missing } = evaluateGate(results, judgments, jev, { thresholds: [0.3, 0.5] });
    expect(rows[0]).toMatchObject({ threshold: 0.3, candidates: 3, missing: 1, injected: 2, judged: 2, correct: 1, precision: 0.5 });
    expect(rows[1]).toMatchObject({ threshold: 0.5, candidates: 1, missing: 1, injected: 0, judged: 0, precision: null, meetsBar: false });
    expect(missing).toEqual([{ case: "c", path: "facts/c.md" }]);
  });
  it("a Jev no or an unsure score injects nothing", () => {
    const jev = [{ case: "a", path: "facts/a.md", p: 0.9 }, { case: "b", path: "facts/b.md", p: null }];
    expect(evaluateGate(results, judgments, jev, { thresholds: [0.3] }).rows[0].injected).toBe(0);
  });
});

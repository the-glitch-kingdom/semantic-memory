import { describe, it, expect } from "vitest";
import { diagnose, isVerified, judgeTargets, top3Shares, formatSections } from "../../src/core/retrieval-eval/report.js";
import { DEFAULT_TARGETS } from "../../src/core/retrieval-eval/targets.js";
import type { ArmReport } from "../../src/core/retrieval-eval/suite.js";
import type { FacetCase } from "../../src/core/retrieval-eval/metrics.js";

const NOW = Date.parse("2026-11-14");
const arm = (outcomes: Record<string, number>, at1 = 0, at3 = 0, n = 0) => ({ outcomes, all: { tiers: { all: { n, at: { 1: at1, 3: at3, 8: 0 } } } } }) as unknown as ArmReport;
const docs = new Map([["a.md", "---\nlast_verified: 2026-11-01\n---\nalpha"], ["b.md", "beta"], ["c.md", "---\nlast_verified: 2025-01-01\n---\ngamma"]]);
const c = (id: string, f: string, extra = {}): FacetCase => ({ id, tier: "exact", q: id, facets: [f], ...extra });

describe("isVerified", () => {
  it("accepts a recent last_verified or a verified verdict, refuses old, missing and future", () => {
    expect(isVerified(docs.get("a.md")!, undefined, NOW)).toBe(true);
    expect(isVerified(docs.get("c.md")!, undefined, NOW)).toBe(false);
    expect(isVerified(docs.get("c.md")!, "verified", NOW)).toBe(true);
    expect(isVerified("no frontmatter", undefined, NOW)).toBe(false);
    expect(isVerified("---\nlast_verified: 2030-01-01\n---\nx", undefined, NOW)).toBe(false);
  });
});

describe("diagnose", () => {
  const live = [c("cov", "zzz", { blind: true }), c("rank", "beta"), c("ground", "gamma"), c("dead", "alpha"), c("ok", "alpha")];
  const hybrid = arm({ cov: 0, rank: 3, ground: 1, dead: 1, ok: 1 });
  const grep = arm({ cov: 0, rank: 8, ground: 1, dead: 1, ok: 1 }, 3, 3, 5);
  const top3 = { rank: ["b.md"], ground: ["c.md"], dead: ["a.md"], ok: ["a.md"] };
  const ground = { dead: { "a.md": { dead: 1 } } };
  const d = diagnose(live, docs, hybrid, grep, top3, ground);
  it("labels coverage, ranking (with the grep oracle), and grounding", () => {
    expect(d.cases.map((x) => [x.id, x.label])).toEqual([["cov", "coverage"], ["rank", "ranking"], ["ground", "grounding"], ["dead", "grounding"]]);
    expect(d.cases[1].grepAt8).toBe(true);
    expect(d.cases[2].why).toContain("unverified");
    expect(d.cases[3].why).toContain("missing ref");
    expect(d.counts).toEqual({ coverage: 1, ranking: 1, grounding: 2 });
    expect(d.grep).toEqual({ at1: 3, at3: 3, n: 5 });
  });
});

describe("judgeTargets", () => {
  const m = (at1: number) => ({ tiers: { all: { n: 4, at: { 1: at1, 3: 4, 8: 4 }, expandedAt1: 4, pathAt1: 0 } }, negativeTop: [], negativesFlagged: 0, answerableFlagged: 0, latencyMs: { p50: 1, p95: 50 } }) as any;
  const shares = { verified: 1, noRefs: 1 };
  it("is not validated without a blind set, and judges the blind subset when there is one", () => {
    expect(judgeTargets(DEFAULT_TARGETS, m(4), shares, null).rows.every((r) => r.met === "not validated")).toBe(true);
    const t = judgeTargets(DEFAULT_TARGETS, m(4), shares, { m: m(2), shares, n: 4 });
    const row = (k: string) => t.rows.find((r) => r.metric === k)!;
    expect(row("hybrid_at1")).toMatchObject({ value: 1, valueBlind: 0.5, met: false });
    expect(row("p95_ms").met).toBe(true);
    expect(row("negatives_flagged").met).toBeNull(); // no negatives measured: shown, not judged
    expect(t.noise).toBe(0.25);
  });
  it("top3Shares counts slots and skips negatives", () => {
    expect(top3Shares([c("x", "a"), { ...c("n", "a"), tier: "negative" }], { x: ["a.md", "c.md"], n: ["b.md"] }, { x: { "c.md": { dead: 2 } } }, (p) => docs.get(p) ?? "")).toEqual({ verified: 0.5, noRefs: 0.5 });
  });
  it("formatSections prints Targets then Diagnosis", () => {
    const out = formatSections({ targets: judgeTargets(DEFAULT_TARGETS, m(4), shares, null), diagnosis: d0 }).join("\n");
    expect(out).toMatch(/Targets[\s\S]*noise: 1\/n = 0\.250[\s\S]*not validated: no blind set[\s\S]*Diagnosis[\s\S]*grep oracle/);
  });
  const d0 = { cases: [], counts: { coverage: 0, ranking: 0, grounding: 0 }, grep: { at1: 0, at3: 0, n: 0 } };
});

describe("diagnose: nearest doc of a coverage case", () => {
  const d2 = new Map([["x.md", "one two"], ["y.md", "one two"], ["archive/z.md", "one two three"], ["w.md", "one"]]);
  const cov = { id: "k", tier: "exact", q: "k", facets: ["one", "two", "three", "nine"], blind: true } as FacetCase;
  const run = (top8: string[]) => diagnose([cov], d2, arm({ k: 0 }), arm({ k: 0 }, 0, 0, 1), {}, {}, { k: top8 }).cases[0];
  it("ties go to the higher hybrid rank, then path; archive never counts; rank is null outside the top 8; a facet only in archive is missing", () => {
    expect(run(["y.md", "x.md"])).toMatchObject({ missing_facets: ["three", "nine"], nearest_doc: { path: "y.md", facet_coverage: "2/4", rank: 1 } });
    expect(run([]).nearest_doc).toEqual({ path: "x.md", facet_coverage: "2/4", rank: null });
  });
  it("omits nearest_doc and prints none when no doc holds a facet", () => {
    const k = diagnose([{ ...cov, facets: ["qqq"] }], d2, arm({ k: 0 }), arm({ k: 0 }, 0, 0, 1), {}, {}).cases[0];
    expect(k).not.toHaveProperty("nearest_doc");
    expect(formatSections({ diagnosis: { cases: [k], counts: { coverage: 1, ranking: 0, grounding: 0 }, grep: { at1: 0, at3: 0, n: 1 } } }).join("\n")).toContain("nearest: none");
  });
});

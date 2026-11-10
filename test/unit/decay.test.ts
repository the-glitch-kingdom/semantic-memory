import { describe, it, expect, vi, afterEach } from "vitest";
import { groundingBlock, groundingMultiplier, computeDecay, decayClock, decayForDoc, normalizeVerifiedDate, DEFAULT_DECAY_CONFIG, type DecayConfig } from "../../src/core/decay.js";

const NOW = Date.parse("2026-07-10T00:00:00Z");
function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
}
const cfg = (over: Partial<DecayConfig> = {}): DecayConfig => ({ ...DEFAULT_DECAY_CONFIG, ...over });

describe("computeDecay", () => {
  it("returns 1.0 when disabled", () => {
    const r = computeDecay({ type: "gotcha", last_verified: daysAgo(1000), config: cfg({ enabled: false }), nowMs: NOW });
    expect(r.multiplier).toBe(1.0);
  });

  it("returns ~0.5 at exactly one half-life", () => {
    const r = computeDecay({ type: "note", last_verified: daysAgo(365), config: cfg(), nowMs: NOW });
    expect(r.multiplier).toBeCloseTo(0.5, 2);
    expect(r.age_days).toBeCloseTo(365, 0);
  });

  it("floors at 0.1 when age is many half-lives", () => {
    const r = computeDecay({ type: "gotcha", last_verified: daysAgo(180 * 10), config: cfg(), nowMs: NOW });
    expect(r.multiplier).toBe(0.1);
  });

  it("resolves the per-type half-life (gotcha=180 decays faster than note=365)", () => {
    const gotcha = computeDecay({ type: "gotcha", last_verified: daysAgo(180), config: cfg(), nowMs: NOW });
    const note = computeDecay({ type: "note", last_verified: daysAgo(180), config: cfg(), nowMs: NOW });
    expect(gotcha.multiplier).toBeCloseTo(0.5, 2);
    expect(note.multiplier).toBeGreaterThan(gotcha.multiplier);
    expect(gotcha.effective_half_life).toBe(180);
  });

  it("never decays a type with a null half-life (source)", () => {
    const r = computeDecay({ type: "source", last_verified: daysAgo(5000), config: cfg(), nowMs: NOW });
    expect(r.multiplier).toBe(1.0);
    expect(r.reason).toMatch(/never decays/);
  });

  it("fresh mode fails open (1.0) when last_verified is missing", () => {
    const r = computeDecay({ type: "note", config: cfg({ missing_last_verified: "fresh" }), nowMs: NOW });
    expect(r.source).toBe("fresh");
    expect(r.multiplier).toBe(1.0);
  });

  it("fresh mode keeps the v1.10.0 results for missing, unparseable and future dates (#49 check 2)", () => {
    const c = cfg({ missing_last_verified: "fresh" });
    const r = (last_verified?: string) => computeDecay({ type: "note", last_verified, fallback_date: daysAgo(900), config: c, nowMs: NOW });
    expect(r()).toMatchObject({ multiplier: 1, age_days: 0, reason: "no last_verified (fail open)" });
    expect(r("nope")).toMatchObject({ multiplier: 1, age_days: 0, reason: "unparseable last_verified (fail open)" });
    expect(r(daysAgo(-30))).toMatchObject({ multiplier: 1, reason: "last_verified in the future (fail open)" });
    expect(r(daysAgo(-30)).age_days).toBeCloseTo(-30, 5);
  });

  it("fresh mode fails open (1.0) when last_verified is in the future", () => {
    const r = computeDecay({ type: "note", last_verified: daysAgo(-30), config: cfg({ missing_last_verified: "fresh" }), nowMs: NOW });
    expect(r.multiplier).toBe(1.0);
  });

  it("fresh mode fails open (1.0) on an unparseable last_verified", () => {
    const r = computeDecay({ type: "note", last_verified: "not-a-date", config: cfg({ missing_last_verified: "fresh" }), nowMs: NOW });
    expect(r.multiplier).toBe(1.0);
  });

  it("pins evergreen notes at 1.0 while verified within 365d", () => {
    const r = computeDecay({ type: "note", last_verified: daysAgo(300), evergreen: true, config: cfg(), nowMs: NOW });
    expect(r.multiplier).toBe(1.0);
    expect(r.evergreen).toBe(true);
  });

  it("lets an evergreen note decay once its verification is older than 365d", () => {
    const r = computeDecay({ type: "note", last_verified: daysAgo(400), evergreen: true, config: cfg(), nowMs: NOW });
    expect(r.multiplier).toBeLessThan(1.0);
  });

  it("normalizeVerifiedDate handles YAML Date objects and strings (regression: unquoted dates)", () => {
    expect(normalizeVerifiedDate("2019-01-01")).toBe("2019-01-01");
    // YAML parses an unquoted `last_verified: 2019-01-01` into a Date
    const asDate = new Date("2019-01-01T00:00:00Z");
    expect(normalizeVerifiedDate(asDate)).toBe(asDate.toISOString());
    expect(normalizeVerifiedDate(undefined)).toBeUndefined();
    expect(normalizeVerifiedDate(42)).toBeUndefined();
    // and the normalized Date flows through computeDecay to actual decay
    const r = computeDecay({ type: "gotcha", last_verified: normalizeVerifiedDate(asDate), config: cfg(), nowMs: NOW });
    expect(r.multiplier).toBeLessThan(1);
  });

  it("hotness boost (when enabled) extends effective half-life", () => {
    const base = computeDecay({ type: "note", last_verified: daysAgo(365), inbound_link_count: 10, config: cfg(), nowMs: NOW });
    const hot = computeDecay({
      type: "note",
      last_verified: daysAgo(365),
      inbound_link_count: 10,
      config: cfg({ hotness_boost: { enabled: true, cap: 2.0 } }),
      nowMs: NOW,
    });
    expect(hot.effective_half_life).toBeGreaterThan(base.effective_half_life);
    expect(hot.multiplier).toBeGreaterThan(base.multiplier);
  });
});

describe("computeDecay missing_last_verified", () => {
  const mode = (m: DecayConfig["missing_last_verified"]) => cfg({ missing_last_verified: m });

  it("git and mtime age a note by the fallback date, same as an equal last_verified (400 days)", () => {
    const want = computeDecay({ type: "note", last_verified: daysAgo(400), config: cfg(), nowMs: NOW });
    for (const m of ["git", "mtime"] as const) {
      const r = computeDecay({ type: "note", fallback_date: daysAgo(400), config: mode(m), nowMs: NOW });
      expect(r.multiplier).toBeCloseTo(want.multiplier, 10);
      expect(r.source).toBe(m);
    }
    expect(want.source).toBe("last_verified");
  });

  it("takes the penalty with no fallback date, and in penalty mode even with one", () => {
    for (const r of [
      computeDecay({ type: "note", config: mode("git"), nowMs: NOW }),
      computeDecay({ type: "note", config: mode("mtime"), nowMs: NOW }),
      computeDecay({ type: "note", fallback_date: daysAgo(1), config: mode("penalty"), nowMs: NOW }),
    ]) {
      expect(r.multiplier).toBe(0.85);
      expect(r.source).toBe("penalty");
    }
  });

  it("unparseable and future last_verified use the fallback too; a future fallback is no date", () => {
    expect(computeDecay({ type: "note", last_verified: "nope", fallback_date: daysAgo(365), config: mode("git"), nowMs: NOW }).multiplier).toBeCloseTo(0.5, 2);
    expect(computeDecay({ type: "note", last_verified: daysAgo(-9), fallback_date: daysAgo(365), config: mode("git"), nowMs: NOW }).source).toBe("git");
    expect(computeDecay({ type: "note", fallback_date: daysAgo(-9), config: mode("git"), nowMs: NOW }).source).toBe("penalty");
  });

  it("a usable last_verified wins over the fallback; a never-decays type ignores it", () => {
    expect(computeDecay({ type: "note", last_verified: daysAgo(10), fallback_date: daysAgo(900), config: cfg(), nowMs: NOW }).source).toBe("last_verified");
    expect(computeDecay({ type: "source", fallback_date: daysAgo(900), config: cfg(), nowMs: NOW }).multiplier).toBe(1);
  });

  it("loadDecayConfig defaults to git / 0.85 and rejects bad values", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadDecayConfig } = await import("../../src/core/decay.js");
    const d = mkdtempSync(join(tmpdir(), "decaycfg-"));
    expect(loadDecayConfig(d).missing_last_verified).toBe("git");
    writeFileSync(join(d, "vault.schema.yml"), "decay:\n  missing_last_verified: mtime\n  missing_penalty: 0.5\n");
    expect(loadDecayConfig(d)).toMatchObject({ missing_last_verified: "mtime", missing_penalty: 0.5 });
    writeFileSync(join(d, "vault.schema.yml"), "decay:\n  missing_last_verified: sometimes\n  missing_penalty: 7\n");
    expect(loadDecayConfig(d)).toMatchObject({ missing_last_verified: "git", missing_penalty: 0.85 });
    writeFileSync(join(d, "vault.schema.yml"), "decay:\n  code: false\n");
    expect(loadDecayConfig(d).code).toEqual({ ...DEFAULT_DECAY_CONFIG.code, enabled: false });
    writeFileSync(join(d, "vault.schema.yml"), "decay:\n  code:\n    drift_penalty: 0.97\n");
    expect(loadDecayConfig(d).code).toEqual({ ...DEFAULT_DECAY_CONFIG.code, drift_penalty: 0.97 });
  });
});

describe("groundingMultiplier and groundingBlock", () => {
  const c = DEFAULT_DECAY_CONFIG.code;
  const g = (drift: number, dead: number, verdict?: string) => ({ source: "export" as const, verdict, code_drift: Array.from({ length: drift }, (_, i) => `f${i}`), dead_refs: Array.from({ length: dead }, (_, i) => `d${i}`) });
  it("is 1 with no grounding or when disabled", () => {
    expect(groundingMultiplier(undefined, c)).toBe(1);
    expect(groundingMultiplier(g(2, 1), { ...c, enabled: false })).toBe(1);
  });
  it("ranks by dead refs only by default: drift is information", () => {
    expect(groundingMultiplier(g(10, 0), c)).toBe(1);
    expect(groundingMultiplier(g(10, 1), c)).toBeCloseTo(0.95);
  });
  it("multiplies per dead ref, and per drifted file when drift_penalty < 1, each capped at 3, floored", () => {
    const d = { ...c, drift_penalty: 0.97 };
    expect(groundingMultiplier(g(1, 0), d)).toBeCloseTo(0.97);
    expect(groundingMultiplier(g(10, 0), d)).toBeCloseTo(0.97 ** 3);
    expect(groundingMultiplier(g(2, 2), d)).toBeCloseTo(0.97 ** 2 * 0.95 ** 2);
    expect(groundingMultiplier(g(0, 10), c)).toBeCloseTo(0.95 ** 3);
    expect(groundingMultiplier(g(3, 3), { ...c, drift_penalty: 0.5 })).toBe(0.8);
  });
  it("archive-candidate adds a factor after the floor; other verdicts add nothing", () => {
    expect(groundingMultiplier(g(0, 0, "archive-candidate"), c)).toBeCloseTo(0.85);
    expect(groundingMultiplier(g(0, 0, "stale"), c)).toBe(1);
  });
  it("the block is absent with nothing to report, shows a verdict only for the flagged ones, and counts what it cuts", () => {
    expect(groundingBlock(g(0, 0, "verified"))).toBeUndefined();
    expect(groundingBlock(g(0, 0, "check"))).toMatchObject({ verdict: "check" });
    expect(groundingBlock(g(5, 4))).toMatchObject({ code_drift: ["f0", "f1", "f2"], dead_refs: ["d0", "d1", "d2"], more: 3 });
  });
});

describe("decayForDoc day clock (#88)", () => {
  afterEach(() => vi.useRealTimers());
  const doc = { frontmatter: { last_verified: "2026-06-01" } };

  it("gives one multiplier for every call on the same UTC day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-07-10T10:00:00Z"));
    const first = decayForDoc(doc, cfg()).multiplier;
    vi.setSystemTime(Date.parse("2026-07-10T10:00:00.040Z"));
    expect(decayForDoc(doc, cfg()).multiplier).toBe(first);
  });

  it("keeps near-tied docs in the same order and scores 40 ms apart", () => {
    // A is older than B, so its multiplier is lower; B's base score is set so the two cross inside the 40 ms window
    const a = { frontmatter: { last_verified: "2026-06-01" } }, b = { frontmatter: { last_verified: "2026-06-02" } };
    const rank = () => [["a", 1, a], ["b", 0.9999999995, b]].map(([n, s, d]) => ({ n, score: (s as number) * decayForDoc(d as typeof a, cfg()).multiplier })).sort((x, y) => y.score - x.score);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-07-10T10:00:00Z"));
    const t0 = rank();
    vi.setSystemTime(Date.parse("2026-07-10T10:00:00.040Z"));
    const t1 = rank();
    expect(t1.map((r) => r.n)).toEqual(t0.map((r) => r.n));
    expect(t1.map((r) => r.score)).toEqual(t0.map((r) => r.score));
  });

  it("ends the UTC day, and a doc verified today or later today is not penalised", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-07-10T10:00:00Z"));
    expect(decayClock()).toBe(Date.parse("2026-07-11T00:00:00Z"));
    for (const lv of ["2026-07-10", "2026-07-10T09:00:00Z", "2026-07-10T23:00:00Z"]) {
      const d = decayForDoc({ frontmatter: { last_verified: lv } }, cfg());
      expect(d.block?.source ?? "last_verified").toBe("last_verified");
      expect(d.multiplier).toBeGreaterThan(0.99);
    }
    // tomorrow is still the future, so it takes the fallback
    expect(decayForDoc({ frontmatter: { last_verified: "2026-07-11" } }, { ...cfg(), missing_last_verified: "penalty" }).block?.source).toBe("penalty");
  });

  it("moves exactly one day across UTC midnight", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-07-10T23:59:59Z"));
    const before = decayForDoc(doc, cfg()).multiplier;
    vi.setSystemTime(Date.parse("2026-07-11T00:00:01Z"));
    const hl = cfg().default_half_life_days;
    expect(decayForDoc(doc, cfg()).multiplier / before).toBeCloseTo(Math.pow(0.5, 1 / hl), 10);
  });

  it("keeps evergreen, per_type null and the git/mtime fallbacks as before, on the day clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-07-10T10:00:00Z"));
    expect(decayForDoc({ frontmatter: { last_verified: "2026-06-01", evergreen: true } }, cfg()).multiplier).toBe(1);
    expect(decayForDoc({ frontmatter: { type: "source", last_verified: "2020-01-01" } }, cfg()).multiplier).toBe(1);
    const age = (d: ReturnType<typeof decayForDoc>) => d.block?.age_days;
    const git = decayForDoc({ frontmatter: {}, gitDate: "2026-06-10T00:00:00Z", mtime: "2026-01-01T00:00:00Z" }, cfg());
    expect(git.block?.source).toBe("git");
    expect(age(git)).toBe(31); // 2026-06-10 to the end of 2026-07-10
    const mt = decayForDoc({ frontmatter: {}, gitDate: "2026-06-10T00:00:00Z", mtime: "2026-06-20T00:00:00Z" }, { ...cfg(), missing_last_verified: "mtime" });
    expect(mt.block?.source).toBe("mtime");
    expect(age(mt)).toBe(21);
  });
});

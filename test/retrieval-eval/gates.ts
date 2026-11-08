import { it, expect } from "vitest";
import type { ArmMetrics } from "./eval.js";

export interface SplitFloor { search_semantic: number; search_hybrid: number }
/** Per arm, per tier (incl. "all"): the lowest answer@1 and answer@3 a run may report. */
export type TierFloors = Record<string, Record<string, { at1: number; at3: number }>>;
/** `known` names gates that v1.9.0 fails; they run as it.fails so the suite is green but flips red the moment the cause is fixed (v191-ranking-regression Phase 4 turns them into real gates). */
export function splitGates(label: string, get: () => { search_semantic: ArmMetrics; search_hybrid: ArmMetrics }, floor: SplitFloor, known: { atOne?: boolean; paraphrase?: boolean; falseFlags?: boolean; negatives?: boolean; negativesSlack?: number } = {}, tierFloors?: TierFloors) {
  const gate = (isKnown?: boolean) => (isKnown ? it.fails : it);
  gate(known.atOne)(`${label}: hybrid answer@1 is at most one case below semantic`, () => {
    const { search_semantic: s, search_hybrid: h } = get();
    expect(h.tiers.all.at[1]).toBeGreaterThanOrEqual(s.tiers.all.at[1] - 1);
  });
  gate(known.paraphrase)(`${label}: hybrid paraphrase answer@1 is at least semantic's`, () => {
    const { search_semantic: s, search_hybrid: h } = get();
    expect(h.tiers.paraphrase.at[1]).toBeGreaterThanOrEqual(s.tiers.paraphrase.at[1]);
  });
  gate(known.negatives)(`${label}: every negative is flagged no_strong_match`, () => {
    const h = get().search_hybrid;
    expect(h.negativesFlagged).toBeGreaterThanOrEqual(h.negativeTop.length - (known.negativesSlack ?? 0));
  });
  gate(known.falseFlags)(`${label}: no_strong_match false-flags at most 10% of answerable cases`, () => {
    const h = get().search_hybrid;
    expect(h.answerableFlagged / h.tiers.all.n).toBeLessThanOrEqual(0.1);
  });
  it(`${label}: answer@1 never drops below the recorded floor`, () => {
    const a = get();
    for (const arm of ["search_semantic", "search_hybrid"] as const) expect(a[arm].tiers.all.at[1], arm).toBeGreaterThanOrEqual(floor[arm]);
  });
  if (tierFloors) it(`${label}: answer@1 and answer@3 never drop below the floor of any tier`, () => {
    const a = get();
    for (const [arm, tiers] of Object.entries(tierFloors)) {
      for (const [tier, f] of Object.entries(tiers)) {
        const got = (a as any)[arm].tiers[tier];
        expect(got?.at[1], `${arm} ${tier} @1`).toBeGreaterThanOrEqual(f.at1);
        expect(got?.at[3], `${arm} ${tier} @3`).toBeGreaterThanOrEqual(f.at3);
      }
    }
  });
}

/** Identifier negatives (`negative_kind: identifier`) run apart from the main arms so they leave the old gates alone. `known` runs it as an expected failure until identifier-abstention ships. */
export function identifierGate(label: string, get: () => ArmMetrics, known: boolean) {
  (known ? it.fails : it)(`${label}: at least 4 of 7 identifier negatives are flagged no_strong_match`, () => {
    const m = get();
    expect(m.negativesFlagged).toBeGreaterThanOrEqual(Math.ceil((m.negativeTop.length * 4) / 7));
  });
}

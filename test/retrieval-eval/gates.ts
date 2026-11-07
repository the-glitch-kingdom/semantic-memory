import { it, expect } from "vitest";
import type { ArmMetrics } from "./eval.js";

export interface SplitFloor { search_semantic: number; search_hybrid: number }
/** `known` names gates that v1.9.0 fails; they run as it.fails so the suite is green but flips red the moment the cause is fixed (v191-ranking-regression Phase 4 turns them into real gates). */
export function splitGates(label: string, get: () => { search_semantic: ArmMetrics; search_hybrid: ArmMetrics }, floor: SplitFloor, known: { atOne?: boolean; paraphrase?: boolean } = {}) {
  const gate = (isKnown?: boolean) => (isKnown ? it.fails : it);
  gate(known.atOne)(`${label}: hybrid answer@1 is at most one case below semantic`, () => {
    const { search_semantic: s, search_hybrid: h } = get();
    expect(h.tiers.all.at[1]).toBeGreaterThanOrEqual(s.tiers.all.at[1] - 1);
  });
  gate(known.paraphrase)(`${label}: hybrid paraphrase answer@1 is at least semantic's`, () => {
    const { search_semantic: s, search_hybrid: h } = get();
    expect(h.tiers.paraphrase.at[1]).toBeGreaterThanOrEqual(s.tiers.paraphrase.at[1]);
  });
  it(`${label}: answer@1 never drops below the recorded floor`, () => {
    const a = get();
    for (const arm of ["search_semantic", "search_hybrid"] as const) expect(a[arm].tiers.all.at[1], arm).toBeGreaterThanOrEqual(floor[arm]);
  });
}

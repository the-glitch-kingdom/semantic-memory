/**
 * Adoption gate for learned skills (v1.7): turns eval scores into adopt / keep-draft / reject. Pure — no I/O.
 * A new skill must trigger on its own evidence, stay quiet on near-misses and beat doing the task without it;
 * a patch must not make any score worse. A failing draft stays a draft with its scores.
 */

/** A skill that fires on fewer than half its own held-out prompts is not findable. */
export const GATE_MIN_POSITIVE_RATE = 0.5;
/** More than a quarter false triggers on near-misses means it would hijack unrelated work. */
export const GATE_MAX_FALSE_TRIGGER_RATE = 0.25;

/** Held-out trigger rates and task pass rates, each 0..1 or null when not measured. */
export interface SkillScores {
  positiveRate: number | null;
  falseTriggerRate: number | null;
  taskWith: number | null;
  taskWithout: number | null;
}

export interface GateVerdict {
  verdict: "adopt" | "keep-draft" | "reject";
  reasons: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function gateSkill(candidate: SkillScores, current?: SkillScores): GateVerdict {
  return current ? gatePatch(candidate, current) : gateNew(candidate);
}

function gateNew(s: SkillScores): GateVerdict {
  const fails: string[] = [];
  if (s.positiveRate === null) fails.push("held-out positive trigger rate not measured");
  else if (s.positiveRate < GATE_MIN_POSITIVE_RATE) fails.push(`positive trigger rate ${pct(s.positiveRate)} < ${pct(GATE_MIN_POSITIVE_RATE)}`);
  if (s.falseTriggerRate === null) fails.push("near-miss false-trigger rate not measured");
  else {
    if (s.falseTriggerRate > GATE_MAX_FALSE_TRIGGER_RATE) fails.push(`false-trigger rate ${pct(s.falseTriggerRate)} > ${pct(GATE_MAX_FALSE_TRIGGER_RATE)}`);
    if (s.positiveRate !== null && s.positiveRate <= s.falseTriggerRate) fails.push(`positive rate ${pct(s.positiveRate)} does not beat false-trigger rate ${pct(s.falseTriggerRate)}`);
  }
  if (s.taskWith === null || s.taskWithout === null) fails.push("task check not measured");
  else if (s.taskWith <= s.taskWithout) fails.push(`task pass ${pct(s.taskWith)} with the skill does not beat ${pct(s.taskWithout)} without`);
  return fails.length ? { verdict: "keep-draft", reasons: fails } : { verdict: "adopt", reasons: ["all gate checks passed"] };
}

function gatePatch(patched: SkillScores, current: SkillScores): GateVerdict {
  const regress: string[] = [];
  const unmeasured: string[] = [];
  const check = (label: string, now: number | null, before: number | null, higherIsBetter: boolean) => {
    if (before === null) return;
    if (now === null) return void unmeasured.push(`${label} not measured for the patch`);
    if (higherIsBetter ? now < before : now > before) regress.push(`${label} ${pct(before)} -> ${pct(now)}`);
  };
  check("positive trigger rate", patched.positiveRate, current.positiveRate, true);
  check("false-trigger rate", patched.falseTriggerRate, current.falseTriggerRate, false);
  check("task pass rate", patched.taskWith, current.taskWith, true);
  if (regress.length) return { verdict: "reject", reasons: regress.map((r) => `regresses: ${r}`) };
  if (unmeasured.length) return { verdict: "keep-draft", reasons: unmeasured };
  return { verdict: "adopt", reasons: ["no score dropped versus the current version"] };
}

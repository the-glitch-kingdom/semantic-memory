/**
 * Adapted from Anthropic's skill-creator (https://github.com/anthropics/claude-plugins-official, Apache License 2.0); modified for semantic-memory.
 */

/**
 * Grade one outcome against a skill's `## Verify` text (jev mode off). Skill-creator's grader rules: a pass needs
 * clear evidence of real completion, not surface compliance; no evidence, or superficial evidence, is a fail.
 */
export const graderPrompt = (verify: string, outcome: string) =>
  `You are a grader. Decide whether the outcome below satisfies the expectation.

PASS: there is clear evidence the expectation is true AND the evidence reflects genuine task completion, not surface-level compliance.
FAIL: there is no evidence, or the evidence contradicts the expectation, or it is superficial (a claim of success with nothing to back it).
Judge only from the outcome text; do not assume anything it does not say.

<expectation>
${verify}
</expectation>

<outcome>
${outcome}
</outcome>

Answer with only JSON: {"passed": true|false, "evidence": "<one sentence quoting or describing what you found>"}`;

/** Parse the grader's reply; anything unparseable is a fail (the safe default). */
export function parseGrade(text: string): { passed: boolean; evidence: string } {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m ? m[0] : "");
    return { passed: j.passed === true, evidence: String(j.evidence ?? "") };
  } catch {
    return { passed: false, evidence: "grader gave no JSON" };
  }
}

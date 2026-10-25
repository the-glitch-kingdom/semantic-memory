/**
 * Adapted from Anthropic's skill-creator (https://github.com/anthropics/claude-plugins-official, Apache License 2.0); modified for semantic-memory.
 */

export interface DescriptionAttempt {
  description: string;
  /** "passed/total" on the train prompts */
  score: string;
}

export interface PromptResult {
  text: string;
  triggers: number;
  runs: number;
}

export const DESCRIPTION_LIMIT = 1024;

const list = (rs: PromptResult[]) => rs.map((r) => `  - "${r.text}" (triggered ${r.triggers}/${r.runs} times)\n`).join("");

/** Ask for a better description from the train failures only (held-out results never reach the proposer). */
export function improveDescriptionPrompt(a: {
  name: string;
  skillContent: string;
  description: string;
  score: string;
  missed: PromptResult[];
  falseTriggers: PromptResult[];
  history: DescriptionAttempt[];
}): string {
  let p = `You are optimizing a skill description for a Claude Code skill called "${a.name}". A "skill" is sort of like a prompt, but with progressive disclosure -- there's a title and description that Claude sees when deciding whether to use the skill, and then if it does use the skill, it reads the .md file which has lots more details.

The description appears in Claude's "available_skills" list. When a user sends a query, Claude decides whether to invoke the skill based solely on the title and on this description. Your goal is to write a description that triggers for relevant queries, and doesn't trigger for irrelevant ones.

Here's the current description:
<current_description>
"${a.description}"
</current_description>

Current scores (train ${a.score}):
<scores_summary>
`;
  if (a.missed.length) p += `FAILED TO TRIGGER (should have triggered but didn't):\n${list(a.missed)}\n`;
  if (a.falseTriggers.length) p += `FALSE TRIGGERS (triggered but shouldn't have):\n${list(a.falseTriggers)}\n`;
  if (a.history.length) {
    p += "PREVIOUS ATTEMPTS (do NOT repeat these -- try something structurally different):\n\n";
    for (const h of a.history) p += `<attempt train=${h.score}>\nDescription: "${h.description}"\n</attempt>\n\n`;
  }
  return (
    p +
    `</scores_summary>

Skill content (for context on what the skill does):
<skill_content>
${a.skillContent}
</skill_content>

Based on the failures, write a new and improved description that is more likely to trigger correctly. Do not overfit: don't produce an ever-expanding list of specific queries. Generalize from the failures to broader categories of user intent and situations where this skill would be useful or not useful. The description is injected into ALL queries, so keep it to about 100-200 words. There is a hard limit of ${DESCRIPTION_LIMIT} characters -- stay comfortably under it.

Tips:
- Phrase it in the imperative -- "Use this skill for" rather than "this skill does".
- Focus on the user's intent, what they are trying to achieve, vs. the implementation details.
- The description competes with other skills for Claude's attention -- make it distinctive and immediately recognizable.
- If you're getting lots of failures after repeated attempts, change things up: different sentence structures or wordings.

Please respond with only the new description text in <new_description> tags, nothing else.`
  );
}

/** The follow-up for a description over the limit. */
export const shortenPrompt = (base: string, tooLong: string) =>
  `${base}\n\n---\n\nA previous attempt produced this description, which at ${tooLong.length} characters is over the ${DESCRIPTION_LIMIT}-character hard limit:\n\n"${tooLong}"\n\n` +
  `Rewrite it to be under ${DESCRIPTION_LIMIT} characters while keeping the most important trigger words and intent coverage. Respond with only the new description in <new_description> tags.`;

/** The description inside <new_description> tags, or the whole reply when untagged. */
export const parseNewDescription = (text: string): string =>
  (text.match(/<new_description>([\s\S]*?)<\/new_description>/)?.[1] ?? text).trim().replace(/^"|"$/g, "").trim();

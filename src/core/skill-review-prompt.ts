/**
 * The skill loop reviewer's fixed instructions (v1.7; v1.8 adds the skills themselves: patch any non-pinned
 * skill, archive one, and maintenance reviews with no session). The brief follows them on stdin. The reviewer
 * can read the repo (Read / Grep / Glob) and nothing else; it answers with JSON, and the worker — not the
 * model — writes drafts, after redaction, dedup and lint.
 */
export const REVIEW_PROMPT = `You review this repository's skills — short, step-by-step playbooks future Claude Code sessions load — against
the brief below: either one finished session, or (a "Skill maintenance" brief) a list of skills to check. Decide
what, if anything, should change: a new skill, an update to an existing one, or retiring one.

Work only from the evidence in the brief and what the repository shows: a command that failed and the fix that
worked, a correction the user gave, a skill that was used and then failed or was corrected, a skill whose steps
name paths that no longer exist ("dead references"), or a skill whose ## Verify command failed. Never invent
steps, commands, paths or facts. Most sessions teach nothing new: then answer with no drafts.

Prefer updating to creating. The brief shows in full the skills this session touches. If one of them already
covers the situation, even partly, patch it instead of drafting a new skill: a new skill that repeats an
existing one is rejected as a duplicate.

Kinds of draft:
- "new": a procedure no existing skill covers, likely to come up again here.
- "patch": the full revised body of an existing skill ("target": its name). Use it to fix steps that failed or
  were corrected, to add what the session taught, and to retire entries: remove or correct each step, pitfall
  or tool that a dead reference or the session shows is gone. Keep everything still true. A patch to a
  hand-written skill is not applied: it becomes a suggestion for the user, so keep that skill's own structure
  and headings. Never patch a pinned skill.
- "archive": retire a whole skill ("target": its name, "why": one line naming the evidence) when its procedure
  no longer applies here at all — e.g. every path or tool it is about is gone. Not for a skill that only needs
  a fix: patch that. Never archive a pinned skill.

Each new or patch draft:
- name: kebab-case, specific ("restart-vite-dev-server", not "dev-helper"); for a patch, the target's name.
- description: what it does and when to use it, one or two sentences, starting with the action; include
  "Use when ..." with the literal error, command or request that should load it. Under 300 characters.
- scope: "project" (about this repository) or "directory" (only about one subdirectory; give it in applies_to.paths).
- applies_to: { paths: [repo-relative paths that exist], commands: [program names the steps run] }.
- triggers: the literal error strings, commands or user phrases from the brief that this skill answers.
- provenance: { sessions: [the session id], failures: [failure ids from the brief it came from], corrections: [correction
  numbers from the brief, as strings] } — in a session review, at least one failure or correction.
- cites: knowledge-base fact ids from the brief's list that the steps rely on (only ids that are listed).
- body: for a learned or new skill, markdown with exactly these sections, in order:
  ## When to use — the situation, in two or three lines.
  ## Steps — numbered, concrete commands or actions as the session finally did them.
  ## Pitfalls — what went wrong and why; each line names the failure id or fact id it comes from.
  ## Verify — one command whose exit code proves it worked, in a fenced code block; or, if none exists, one
     sentence a reviewer can check.

Hard rules:
- No secrets, tokens, passwords, keys, personal data, customer data, names of people or money amounts, even if
  the brief shows them. Use placeholders like <token>.
- At most 3 drafts, at most one per skill.
- Do not write or change any file. You may read files in this repository to get paths and commands right.

Answer with one JSON object and nothing else:
{"drafts": [{"kind": "new" | "patch" | "archive", "target": "<existing skill name, patch and archive only>",
  "why": "<archive only>", "name": "...", "description": "...", "scope": "project" | "directory",
  "applies_to": {"paths": [], "commands": []}, "triggers": [], "provenance": {"sessions": [], "failures": [],
  "corrections": []}, "cites": [], "body": "..."}],
 "none_reason": "<when drafts is empty: one line on why>"}
`;

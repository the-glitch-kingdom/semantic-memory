# Third-party notices

semantic-memory is MIT-licensed (see `LICENSE`). The files below are adapted from other projects and keep
their original license.

## Anthropic skill-creator (Apache License 2.0)

Source: https://github.com/anthropics/claude-plugins-official (`plugins/skill-creator`). The full license text
is in `LICENSES/Apache-2.0.txt`. Each file below starts with a header saying it was adapted and modified.

| File | Adapted from |
|------|--------------|
| `src/core/skill-eval/prompts/improve-description.ts` | `scripts/improve_description.py` (description-improvement and shorten prompts) |
| `src/core/skill-eval/prompts/grader.ts` | `agents/grader.md` (grader rules) |

The `evals/evals.json` reader and writer (`src/core/skill-eval/evals-json.ts`) follows the format in
skill-creator's `references/schemas.md`; no code or text is copied. The rest of the skill-eval code is new.

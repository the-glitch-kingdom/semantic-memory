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

## SCOWL word list (MIT-style permissive notice)

`src/core/common-words.ts` holds 31,676 lowercase English words (about 280 KB), taken from SCOWL (Spell Checker Oriented Word
Lists, http://wordlist.sourceforge.net/) as packaged by Debian `wamerican`, with proper nouns, possessives and inflected forms removed.
SCOWL's own README lists further public-domain components (Moby Words II, the UK English Wordlist With Frequency Classification).

> Copyright 2000-2011 by Kevin Atkinson
>
> Permission to use, copy, modify, distribute and sell these word lists, the associated scripts, the output created from the
> scripts, and its documentation for any purpose is hereby granted without fee, provided that the above copyright notice appears
> in all copies and that both that copyright notice and this permission notice appear in supporting documentation. Kevin Atkinson
> makes no representations about the suitability of this array for any purpose. It is provided "as is" without express or implied
> warranty.

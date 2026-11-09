---
name: semantic-first
description: Search the project's indexed docs and vault before grepping, researching on the web, or answering from memory. Use for prose questions about this repo (how/why/where does X work, what is the convention, where is the guide, is there something that does X) and for research questions, which start by checking the vault for earlier findings. Not for exact code-symbol lookups ("where is parseAuth defined"); those are Grep jobs.
---

# semantic-first

Two servers, same tools, probed separately (either can be missing):

- `semantic-memory-docs`: the project docs (usually `.documentation/`). Read-only. Edit docs as files, never through MCP.
- `semantic-memory`: the vault (`.claude/.vault/`), research notes that persist across sessions. Read and write.

When unsure whether a question is prose or a symbol lookup, search first: one call is cheap.

## Look it up

1. `search_hybrid` with the question, `limit` 5-10; `search_text` for an exact string. "Indexing in progress" means wait and retry, not "no results".
2. `read_note` the top 2-3 hits. Never answer from excerpts.
3. Multi-part question (a config, a script and a check): search each part, or read down to result 8. Answer only when every part is covered.
4. End-to-end question: follow `forwardlinks` / `backlinks` from the best note.
5. Answer with the files you used. If the answer is not there, say so; do not guess or switch to the web without saying.

## Read the signals on each result

- `missing_terms`: in no doc and not in the code. Say it is not there; do not answer from the nearest hit.
- `undocumented`: in the code, in no doc. Answer from the code.
- `passing_terms`, or `no_strong_match: true`: weak match. Check the note answers the question before citing it.
- `decay`: past its verification window. Check it against the code.
- `entity` (on result 1) and `related`: where a named symbol is defined, and the docs that cover it. Follow them before searching again.

## Check before you act

Docs describe the code; they are not the code. Grep exact names (env vars, files, functions) and confirm any flag, path or default you are about to rely on.

## Research

1. Answer the repo half of the question first ("how do we do X" before "is there a better X").
2. Search the vault for earlier research. If a note exists, update it rather than writing a second one.
3. Use several sources. File each external one with `ingest_source`.
4. Write the findings with `synthesize_note` (it stamps the frontmatter and provenance). Link related notes with `[[wikilinks]]`; they resolve only to other vault notes.
5. Answer from the note, and give its path.

The vault holds findings on a topic. Facts about the user or project preferences belong in Claude's memory, not the vault.

## If a server is missing

Say so in one sentence, then:

- Docs: Glob/Grep the markdown (`.documentation/`, `docs/`, READMEs), then the code.
- Vault: write the note to `.claude/.vault/` with Write, copying the frontmatter fields of an existing note. If you cannot write there, put the findings in the reply under a "Research findings" heading.

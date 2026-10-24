# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.5.x | ✅ (current) |
| < 1.5 | ❌ — upgrade; 1.5.3 adds secret redaction |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email: `theglitchking@users.noreply.github.com` with the subject prefix `[SECURITY] semantic-memory:`.

Include:
- Affected version(s).
- Reproduction steps (a minimal vault + a specific invocation).
- Impact assessment (what an attacker could achieve).
- Any suggested mitigation.

## Response SLA

- **Acknowledgement:** within 1 week.
- **Assessment:** within 2 weeks.
- **Fix release:** within 4 weeks for confirmed high/critical; best-effort for medium/low.
- **Disclosure:** coordinated — a credited advisory is published after the fix ships.

## What's in scope

Primary attack surface:

- **Vault file I/O** — `apply_patch`, `synthesize_note`, `ingest_source`, and the underlying `NoteCrud` module operate on paths that a user/Claude supplies. Path traversal outside the `--notes <vault>` root is considered a vulnerability.
- **Hook input parsing** — `hooks/vault-context.js` reads JSON from stdin. Parser injection or DoS via malformed input is in scope.
- **MCP tool arg handling** — every tool uses Zod schemas, but unchecked property access after validation is in scope.
- **Spawn calls** — the hook shells out to the `semantic-sidekick` CLI. Command injection via vault paths or query strings is in scope.
- **Log.md writes** — `logEvent` writes user-controllable strings. Log-injection (newlines breaking YAML blocks) is in scope.

## What's out of scope

- The embedder/model download (ONNX runtime) — upstream responsibility of the HuggingFace transformers library.
- Filesystem permission escalation — the tool runs with the user's permissions by design.
- Claude's judgment — the tool trusts Claude to use its tools sensibly within the user's granted permission scope. If Claude makes destructive calls, that's a permission scope question, not a sidekick vulnerability.
- Third-party MCP clients that connect to the server — we test against Claude Code only.

## Hardening notes

Defense-in-depth already in place:

- All `NoteCrud` operations resolve paths against the `notesPath` root and do not accept absolute paths.
- `apply_patch` pre-check verifies collision/existence before any write.
- Schema validation (when `validate: true`, the default) blocks writes that would violate the schema.
- Hooks fail open — any exception emits empty context, never destructive output.
- Log writes are `.catch(() => {})` wrapped — logging failures never mask real errors.

## Secret redaction (v1.5.3+)

Everything stays on the machine (the embedder runs locally; telemetry does no network I/O), but vault notes are usually committed to git. So every write point masks secrets before writing:

- **Notes** — `create_note`, `update_note`, `apply_patch`, `synthesize_note`, `ingest_source`, `synthesize_promote`, `update_frontmatter`, dossiers, the speaker profile, lexicon aliases and `log.md` — use a *precise* pattern set that leaves ordinary content alone (commit SHAs, UUIDs, hashes, paths, placeholders such as `<your-key>` or `${API_TOKEN}`). `update_note` redacts only the text being added.
- **Logs and state** — search queries in `.claude/.semantic-memory/selection.jsonl`, `session.json` (task, `session_run` command and output tail) and the Stop hook's capture-pending excerpts — also mask long base64 and letter-and-digit tokens.
- Detected: exact values of secret-named env vars on this machine (process env and `~/.claude/settings.json` `env`); PEM private keys; `user:pass@` in URLs; `Bearer`/`Basic` headers; secret-named `name=value` / `name: value` / JSON pairs; `--token VALUE` flags; vendor key prefixes (`sk-`/`pk-`/`rk-`, `ghp_`, `github_pat_`, `glpat-`, `xox*-`, `AKIA`/`ASIA`, `AIza`, `whsec_`, `re_`, `hf_`, `npm_`); JWTs.
- Masked values become `[REDACTED]`; tool results report the count, never the value.
- **Not caught:** a secret written as plain prose ("the password is hunter2"). Don't paste secrets into a session.
- **Already committed?** `lint_vault({ checks: ["secrets"] })` lists notes that contain one (path, line, kind). Rotate the secret first — removing it from the note does not remove it from git history.

Design and how to add a pattern: [`.documentation/security/secret-redaction.md`](.documentation/security/secret-redaction.md).

## Dependency updates

- Monthly security review — `npm audit` against the lock file.
- Patch-level upgrades applied within 2 weeks of disclosure for `moderate+` advisories.
- Major upgrades pinned by semver; tested in a separate branch before merge.

## Acknowledgements

None yet. First reporter gets the credit slot here.

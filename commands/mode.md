---
description: Set or query the active semantic-memory mode (vault-first | research | outage-silence)
argument-hint: "[research|vault-first|outage-silence|status]"
allowed-tools: Bash(cat:*), Bash(cp:*), Bash(test:*), Bash(node:*), Read, Write
---

# /mode — semantic-memory mode control

The user invoked `/mode $ARGUMENTS`. This is the explicit ground-truth override for the semantic-memory routing layer.

## Your job

1. **Parse `$ARGUMENTS`** — expected values: `research`, `vault-first`, `outage-silence`, `status` (or empty = status).

2. **Read current mode** from `.claude/.sidekick-mode` (a plain text file containing just the mode name). If the file doesn't exist, the current mode is `vault-first` (default).

3. **If the arg is `status` or empty**, print the current mode and exit:
   ```
   current mode: <mode>
   ```

4. **If the arg is a valid mode name** (`research`, `vault-first`, `outage-silence`), do the transition:

   a. **If transitioning OUT of `research`** → emit the research-exit synthesis prompt:
      > Exiting research-mode. Before switching: the session accumulated source notes and findings. Draft a `synthesize_note` now (dry-run first via `synthesize_note` on the vault server with `dry_run: true`, then apply if the preview looks right). Confirm with the user that the synthesis is filed before finishing the mode change.

   b. **If transitioning OUT of `outage-silence`** → emit the outage-exit postmortem prompt:
      > Exiting outage-silence. The incident is (presumably) resolved. Before switching: draft a postmortem as a `synthesize_note` with `type: gotcha` (or `decision` if the fix is architectural) covering timeline, root cause, fix, and preventive actions. Dry-run first, confirm with the user, then apply.

   c. **Write the new mode** to `.claude/.sidekick-mode` (single line, no trailing newline noise):
      ```bash
      mkdir -p .claude && printf '%s' "<new-mode>" > .claude/.sidekick-mode
      ```

   d. **Report the transition** to the user in one line:
      ```
      mode: <old> → <new>
      ```

   e. If the new mode is `research` or `outage-silence`, invoke the corresponding skill (the skill description will carry you forward). The `vault-first` default is already ambient.

5. **If the arg is an unknown value**, print a one-line error listing the valid values and exit.

## Notes

- The mode file is per-project, stored in `.claude/.sidekick-mode`. It persists across sessions.
- `SessionStart` resets the mode to `vault-first` if the file is missing or contains an invalid value.
- You (Claude) are also the router — the mode file is a signal, not a command. Even without `/mode`, skill descriptions route based on conversational cues. `/mode` is the explicit override.

## Example

User: `/mode research`

You (on read): current mode is `vault-first` → transitioning to `research` → no exit-capture needed (not leaving research or outage). Write the file. Report:
```
mode: vault-first → research
```
Then follow the `research-mode` skill going forward.

User: `/mode vault-first`

You (on read): current mode is `research` → transitioning out of research → emit the synthesis prompt FIRST, wait for the user's go-ahead or confirmation that synthesis is filed, then write the file. Report:
```
mode: research → vault-first
```

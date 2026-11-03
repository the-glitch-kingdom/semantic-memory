---
title: The skill loop — learned skills between sessions
tier: guide
domains:
  - operational
audience:
  - developers
  - admin
tags:
  - v1.7.0
  - skill-loop
  - skills
  - SessionEnd
  - curator
  - skill-eval
  - v1.8.0
  - auto-mode
status: active
last_updated: '2026-11-03'
version: 1.8.0
purpose: What the skill loop does, how to turn it on and off, how drafts are
  made, deduplicated, scoped, reviewed, landed, evaluated and retired, what auto
  mode applies by itself, how hand-written skills get suggestions, what the
  background reviewer can and cannot touch, what it costs, and what turning it
  off leaves behind.
load_priority: 7
estimated_read_time: 8 minutes
word_count: 1427
last_validated: '2026-10-25'
backlinks: []
---

# The skill loop

The vault holds what is *true* about a project; the skill loop learns what to *do*. When a session fails a
command and then finds the fix, or the user corrects the agent, a background review drafts a skill — a short
playbook Claude Code loads when the same situation comes back, updates a skill it already has, or retires one.
Nothing lands until a person approves it, unless you turn on [auto mode](#auto-mode-v180).

It is **off by default**. Off, 1.7.0 behaves exactly like 1.6.1. Auto mode is a second switch, also off by
default; without it 1.8.0 behaves like 1.7.

## Turning it on and off

```bash
semantic-memory skill-loop on        # sets SEMANTIC_MEMORY_SKILL_LOOP=1 in ~/.claude/settings.json env
semantic-memory skill-loop off       # removes it
semantic-memory skill-loop on --repo # this repo only: .claude/.semantic-memory/config → skill_loop: on
semantic-memory skill-loop off --repo           # this repo never, whatever the global switch says
semantic-memory skill-loop off --repo --clear   # drop the override
semantic-memory skill-loop status
```

`/skill-loop on|off|status` in Claude Code runs the same commands. The settings edit touches only that one key
and keeps a `.bak`; it applies from the next session. The repo override beats the global switch both ways.

**Off leaves everything where it is.** No hook writes, no job, no worker, no `claude` run. Skills that already
landed stay in `.claude/skills/` as ordinary files and keep working; drafts and logs stay in
`.claude/.semantic-memory/`.

## How a skill is made

1. **Evidence.** With the loop on, hooks append redacted lines to `.claude/.semantic-memory/`:
   `failures.jsonl` (every failed Bash/MCP call, with or without the failure hook), `corrections.jsonl` (prompts
   like "no, …", "that's wrong", "use X instead", "don't …") and `skill-usage.jsonl` (each skill used, by the
   Skill tool or by typing `/name`).
2. **Enqueue.** At `SessionEnd`, a session with signal — a failure, a correction, or 20+ tool calls
   (`SEMANTIC_MEMORY_SKILL_LOOP_MIN_TOOL_CALLS`) — becomes a job in `~/.semantic-memory/review-queue/`, and the
   repo's worker starts detached. The hook only writes and spawns: SessionEnd hooks get 1.5 s.
   A repo under the system temp directory (`os.tmpdir()`, `/tmp`, `/var/tmp`) is never queued, because benchmark
   and test runs would use the daily cap. `SEMANTIC_MEMORY_SKILL_LOOP_ALLOW_TMP=1` turns this off for a scratch repo.
3. **Review.** The worker builds a brief (the session's prompts, tool calls and errors, the evidence, the skills
   this repo loads, its knowledge-base fact ids), redacted and capped at 40k characters, and runs **one fenced
   `claude -p`** on it. Since 1.8 the brief also holds, **in full**, up to 4 skills the session touches: the ones
   it used, then the ones whose words the session shares most. Each comes with its **dead references** (paths it
   names that no longer exist) and a failed `## Verify`, if `skill-loop verify` flagged one. The reviewer is told
   to prefer updating to creating, and answers with up to 3 drafts, at most one per skill:
   - `new`: a procedure no skill covers
   - `patch`: the full revised body of an existing skill. It fixes what failed or was corrected, adds what the
     session taught, and **retires entries**: steps, pitfalls or tools that a dead reference or the session shows
     are gone
   - `archive`: retire a whole skill, with a one-line `why`, when nothing in it applies here any more
4. **Draft.** Each answer is rendered, redacted, and linted (see [the skill format](../reference/skill-format.md)).
   Rejected and logged: drafts without a failure or correction behind them (except in maintenance reviews),
   failing lint, touching a pinned skill, an archive without a `why`, and **duplicates**. A `new` skill whose name
   matches, or whose words overlap ≥ 0.5 (Jaccard over name, description, triggers and `applies_to`) with, any
   skill this repo loads or any draft still waiting is rejected with the name it duplicates: patch that one
   instead. A patch keeps the provenance its skill already had. A `patch` or `archive` of a **hand-written**
   skill becomes a [suggestion](#suggestions-for-hand-written-skills). The rest go to
   `.claude/.semantic-memory/skill-drafts/<id>/`.

The worker drains this repo's jobs oldest first, one worker per repo (`skill-loop.lock`), and stops at **10
reviews a day across all repos** (`SEMANTIC_MEMORY_SKILL_LOOP_DAILY_RUNS`); the rest wait for tomorrow. A job is
marked done only after its review returns, so a crash leaves it queued; after 3 failed attempts it is set aside
in `review-queue/failed/`. A session gets one review, plus a **follow-up review** if it is resumed and records new
failures or corrections after that review. The follow-up brief holds only the evidence and the transcript entries
after the last review. Tool calls alone never re-queue a reviewed session. Everything is logged in
`.claude/.semantic-memory/skill-loop.log`.

The worker runs `claude` from PATH, or from `~/.local/bin/claude` or `~/.claude/local/claude` when PATH lacks it,
for example in a session started from cron. `SEMANTIC_MEMORY_CLAUDE_BIN` overrides this.

## What the reviewer can and cannot touch

Every `claude` process the skill loop starts runs with:

| Flag | Effect |
|---|---|
| `--tools Read,Grep,Glob` | reviewer can read the repo; no Bash, no Edit, no Write |
| `--disallowedTools Task,Agent` | no subagents |
| `--strict-mcp-config` | no MCP servers — without it, claude.ai connectors (Drive, Docs) load even with `--tools` |
| `--settings '{"disableAllHooks":true}'`, `--setting-sources project,local` | no hooks, no user settings or plugins |
| `--permission-mode dontAsk` | anything that would ask is denied, including reads outside the repo |
| `--no-session-persistence`, `--max-turns 8` | no session file, bounded |
| env `SEMANTIC_MEMORY_REVIEWER=1` | every semantic-memory hook exits at once (recursion guard) |

The reviewer answers JSON; semantic-memory — not the model — writes the draft, and only under `skill-drafts/`.
At most **5** skill-loop `claude` processes run at once on the machine, across repos
(`SEMANTIC_MEMORY_SKILL_LOOP_CONCURRENCY`, 1–5; slots in `~/.semantic-memory/claude-slots/`, reclaimed when their
holder dies). Model: `sonnet` (`SEMANTIC_MEMORY_SKILL_LOOP_MODEL`).

## Scope

| Scope | Lives in | When |
|---|---|---|
| directory | `<repo>/<dir>/.claude/skills/<name>/` | every path the draft names sits under one package subdirectory (it has its own `package.json`, `pyproject.toml` or `.claude/`). Claude Code loads it once Claude touches a file there. |
| project | `<repo>/.claude/skills/<name>/` | it names this repo's paths, or names nothing (the safe default) |
| global | `~/.claude/skills/<name>/` | **only by promotion**: the same lesson exists in another repo, and you approve with `--promote` |

The reviewer's own choice of scope is never used. With jev mode on, a draft that names nothing in the repo gets
one Jev question ("would these steps work unchanged in any repository?"); a yes at ≥ 0.95 only marks it a global
*candidate*. `~/.semantic-memory/skill-index.jsonl` (skill names and paths only) is how another repo's copy is
found. **Private repos** (`SEMANTIC_MEMORY_PRIVATE_PATHS`, default `~/workspace/kentro`, comma-separated) are
always project scope, never indexed, and never reach Jev; Claude still reviews them, since Claude is allowed there.

## Review and landing

```bash
semantic-memory skill-loop review                      # drafts: evidence, scope and why, Verify command, diff
semantic-memory skill-loop review --eval <id>          # trigger eval → scores + the gate's verdict
semantic-memory skill-loop review --eval <id> --task   # also replay the task (runs the draft's Verify command)
semantic-memory skill-loop review --approve <id>
semantic-memory skill-loop review --approve <id> --promote          # one global skill replacing the copies
semantic-memory skill-loop review --approve <id> --override "<why>" # land despite a failing eval gate
semantic-memory skill-loop review --reject <id>
semantic-memory skill-loop rollback <ledger-id>
```

`/skill-loop review` walks the drafts one at a time and asks you, showing the diff for patches and suggestions
and the `why` for archives. SessionStart says once per session how many drafts and suggestions wait. A patch,
archive or suggestion lands only onto the exact bytes it was drafted from. Once evals ran on a draft, it lands
only if the gate adopted it, or with `--override` (the reason goes in the ledger).

Every change — land, patch, promote, merge, stale, archive, restore, reject — is a line in
`.claude/.semantic-memory/skill-ledger.jsonl` with the bytes of every file before and after
(`skill-ledger-blobs/`), so `rollback <id>` restores exactly one change, and refuses if the file changed since.

## Auto mode (v1.8.0)

```bash
semantic-memory skill-loop auto on          # SEMANTIC_MEMORY_SKILL_LOOP_AUTO=1 in ~/.claude/settings.json env
semantic-memory skill-loop auto off
semantic-memory skill-loop auto on --repo   # this repo only: skill_loop_auto: on in .claude/.semantic-memory/config
semantic-memory skill-loop auto off --repo  # this repo never; --clear drops the override
```

With auto mode on, the worker approves its own `new`, `patch` and `archive` drafts for **learned** skills right
after the review, as actor `reviewer` in the ledger. The guard is the same as for drafts: lint and dedup. Evals
do not run (`review --eval` is still there by hand). Every change is one ledger entry with the bytes before and
after, so `semantic-memory skill-loop rollback <ledger id>` undoes exactly that change.

- **What it never does:** change a hand-written or pinned skill, apply a suggestion, promote a skill to global
  scope, or merge.
- **A draft that fails to land stays a draft.** Lint, a target that changed since, or a folder that exists
  already all leave it for `skill-loop review`. The log says why (`auto: <id> left for review — …`).
- **You hear about it.** The next SessionStart lists each change once, with its ledger id:
  `[skill loop] auto mode changed learned skills since you last looked: patch stop-vite-dev-server (ledger …)`.
- Auto mode does nothing while the skill loop itself is off. `skill-loop status` shows both switches.

## Suggestions for hand-written skills

Skills the loop did not write are never changed by it. When the reviewer patches or archives one, the draft is a
**suggestion** (`kind: suggest`, `action: patch | archive`). A patch suggestion keeps the skill's own
frontmatter byte for byte and replaces only the body. Suggestions are listed at SessionStart
(`N suggested changes to hand-written skills`) and in `skill-loop review` with their diff.

- `--approve <id>` applies one (actor `user`, ledgered, rollback works), but only onto unchanged bytes.
- **Linked skills are refused.** Most hand-written skills in `.claude/skills/` are links, often into
  `node_modules` (`relink` makes them), where a package update would undo the edit. Review shows the real file:
  apply the change there by hand, then `--reject` the suggestion.
- `--reject <id>` drops it.

## Maintenance reviews: skills with dead references

When the curator runs (weekly, or `skill-loop curate`), it looks for this repo's skills, learned or hand-written,
that name paths that no longer exist or whose `## Verify` failed (`skill-loop verify`). If any are new since the
last run, it queues **one skill-only review** (`maintenance-<repo hash>-<date>`, no session). The worker reviews
it like a session, and it counts toward the daily cap. The reviewer patches out the dead entries, archives a
skill with nothing left, or leaves it alone. Learned skills follow auto mode; hand-written ones get suggestions.

- A skill is queued once per problem: the same dead references are not queued again. A new one queues it again.
- A skill that already has a draft waiting is skipped.
- `curate --dry-run` lists what it would queue.
- **Dead references are paths only.** These are `applies_to.paths`, and repo-relative paths in code spans and
  fenced blocks whose first segment exists here (so `origin/main` or `owner/repo` are not mistaken for paths).
  Commands are not checked against PATH: the worker's PATH is not the session's.

## Evals

`semantic-memory skill-eval trigger|task|tune <SKILL.md>`, and `review --eval` for drafts. A TypeScript rewrite of
the method in Anthropic's skill-creator; its description and grader prompts are adapted (Apache-2.0, see
`THIRD_PARTY_NOTICES.md`).

- **Test sets from evidence.** Should-trigger prompts are the user prompts of the skill's own sessions;
  near-misses are other sessions' prompts that share its words. Split about 60/40 into train and held-out by a
  hash of the prompt, so the split is the same on every run.
- **trigger** runs each prompt through `claude -p` in a scratch directory holding the skill and copies of the
  repo's other skills (Read/Glob/Grep/Skill only), and checks whether the Skill tool was called with its name.
  Up to 3 runs per prompt, stopping when the first two agree. Results are cached by (skill content hash, prompt
  hash) in `~/.semantic-memory/skill-eval-cache.jsonl`: an unchanged skill costs nothing.
- **task** replays a session's prompt with and without the skill, each in a throwaway `git worktree` of HEAD,
  then checks `## Verify`: a command is run in that copy; prose is graded by Jev (jev mode, ≥ 0.95) or by a grader
  prompt. **It runs a command a model wrote**, in a scratch copy but with network and absolute paths reachable,
  so it only runs when you ask (`--task`), after `review` has shown you the command.
- **tune** proposes better descriptions, scores them on train, keeps the best on held-out, at most 3 rounds.
  It never writes the skill.
- **The gate.** A new skill is adopted when its held-out trigger rate is ≥ 50% and beats its near-miss false
  triggers (which must be ≤ 25%), and the task passes more often with it than without. A patch is adopted when no
  score drops. With few sessions there is no held-out set yet, and the verdict is `keep-draft` — say so honestly,
  or override.

Cost, measured: one review ≈ 14 s and $0.03 (sonnet); a trigger + task eval on a one-session draft = 4 runs, 32 s.
Each `claude` run is fenced exactly like the reviewer, and counts toward the 5-process cap.

## The curator

Every 7 days, when the repo has been quiet for 2 hours, SessionStart starts it detached (never in the first 7
days after the loop first sees a repo). It is deterministic (no model call), apart from queueing a
[maintenance review](#maintenance-reviews-skills-with-dead-references):

- a learned skill unused for **14 days** becomes `stale`; used again, it is `active` again
- unused for **30 days**, it moves to `.claude/.semantic-memory/skills-archive/<name>/` — out of
  `.claude/skills/`, so Claude Code stops loading it. Nothing is deleted.
- never touched: pinned skills (`skill_loop.pinned: true`), skills another skill cites, never-used skills younger
  than 14 days, and every skill the loop did not write

```bash
semantic-memory skill-loop curate --dry-run    # what it would do
semantic-memory skill-loop curate              # do it now
semantic-memory skill-loop restore <name>      # bring an archived skill back
semantic-memory skill-loop verify              # run landed skills' Verify commands; failures are flagged, not archived
```

**Merging is opt-in**: `skill_loop_consolidate: true` in `.claude/.semantic-memory/config`, or
`curate --merge`. Pairs come from word overlap of name, description, triggers and paths. In jev mode Jev must say
the pair is the same procedure, or one contains the other (≥ 0.95), before Claude drafts the merged skill;
otherwise Claude judges and drafts in one call. A merge is a review draft that supersedes both; approving it
archives the old ones in the same ledger entry.

## Files

| Where | What |
|---|---|
| `.claude/skills/`, `<dir>/.claude/skills/`, `~/.claude/skills/` | landed skills (ordinary SKILL.md files; commit project ones) |
| `.claude/.semantic-memory/skill-drafts/` | drafts and suggestions waiting for review |
| `.claude/.semantic-memory/skills-archive/` | archived learned skills |
| `.claude/.semantic-memory/skill-ledger.jsonl`, `skill-ledger-blobs/` | every change, with bytes |
| `.claude/.semantic-memory/{failures,corrections,skill-usage}.jsonl` | evidence (redacted; rotated at 5 MB) |
| `.claude/.semantic-memory/{skill-loop.log, skill-loop.lock, curator.json}` | worker log, worker lock, curator state (incl. `maintained`: what was last queued per skill) |
| `.claude/.semantic-memory/auto-reported.json` | up to which ledger time SessionStart has reported auto-mode changes |
| `~/.semantic-memory/review-queue/` (`done/`, `failed/`) | jobs |
| `~/.semantic-memory/{skill-loop-runs.jsonl, skill-index.jsonl, claude-slots/, skill-eval-cache.jsonl}` | daily cap, cross-repo index, process slots, eval cache |

All of `.claude/.semantic-memory/` is machine-local (gitignored).

## See also

- [The skill format](../reference/skill-format.md) — the `skill_loop:` block and the lint rules
- [Jev mode](jev-mode.md) — the Jev questions the skill loop asks
- [Secret redaction](../security/secret-redaction.md) — every write point above
- [Troubleshooting](../troubleshooting/troubleshooting.md#the-skill-loop)

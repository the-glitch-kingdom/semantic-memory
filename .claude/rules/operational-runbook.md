# template-ai-workspace — Operational Runbook

> Auto-loaded every session. Contains operational knowledge that cannot be derived from code.
> This file grows over time as the team discovers gotchas, quirks, and procedures.
> **Edit this file manually** — it is NOT overwritten on regeneration.

## Environment Differences

<!-- TODO: Document how dev/staging/prod differ (DB, deploy method, secrets, URLs) -->

| | Dev | Staging | Production |
|---|---|---|---|
| **URL** | | | |
| **Database** | | | |
| **Deploy** | | | |
| **Secrets** | | | |

## Known Issues & Workarounds

<!-- This section fills in naturally. When you hit a non-obvious issue, add it here. -->
<!-- Examples: "HMR doesn't work on WSL2", "port 6543 breaks migrations" -->

_No known issues documented yet. When you encounter a non-obvious problem and its solution, add it here so future sessions don't re-discover it._

## Deploy Procedures

### npm publish checklist

Before running `npm publish` (or bumping the version):

1. **Sync the CLI version string** — `src/cli/index.ts` has a `.version(...)` call in the
   `program` definition. It must match `package.json`. It currently reads dynamically from
   `package.json` via `createRequire`, so this is automatic — but if that line ever gets
   reverted to a hardcoded string, `semantic-pages --version` will lie.
   **Verify:** `node dist/cli/index.js --version` should print the version from `package.json`.

2. **Build before publish** — `prepublishOnly` runs `npm run build` automatically, but confirm
   the build is clean before tagging.

3. **Clear npx cache after publish** — consumers using `npx ... @latest` may be served a stale
   cached version. After publishing, clear the cache on affected machines:
   ```bash
   rm -rf ~/.npm/_npx/*/node_modules/@theglitchking
   ```

4. **Bump all five version fields** — `package.json`, both `version` fields in
   `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, and `AGENTS.md` frontmatter.
   Then `npm install --package-lock-only --ignore-scripts`. A missed marketplace field means
   `claude plugin update` keeps serving the old version.

5. **The tarball 404s for a few minutes after publish** — `npm view` shows the new version at
   once, but `npm i …@X.Y.Z` can fail with `404 Not Found - GET …/-/semantic-memory-X.Y.Z.tgz`
   for ~5 minutes. Not a failed publish: wait, don't republish.

Full procedure: `.documentation/deployment/release-process.md`.

### Offline / air-gapped tarball

Self-contained `.tgz` for installs on RHEL 9 / RHEL 10 / Ubuntu 24.04 (x86_64) with
no npm, no Hugging Face, and no GitHub access. The tarball bundles the plugin, vendored
`node_modules`, the embedding model + tokenizer cache, and a self-bundled installer.

**Build (on a connected host running Ubuntu 24.04 + Node 22):**

```bash
./scripts/build-offline-tarball.sh
# → ~/.semantic-sidekick/dist-offline/semantic-sidekick-offline-<version>-<sha>-x64.tgz
```

Build flags:
- `--force` — rebuild even if a tarball with the same name exists
- `--allow-dirty` — build with uncommitted git changes (manifest gitSha will reflect HEAD)
- `--out DIR` — override output directory
- `--skip-model` / `--skip-npm` / `--skip-build` — fast iteration on script changes

The build refuses by default if the working tree is dirty — the manifest's gitSha must mean something.

**Expected size: ~0.55 GB** (1.6.1: 557 MB, model cache 87 MB). Several GB means junk in
`~/.semantic-sidekick/models/`: `model.onnx.<pid>.<ts>.tmp` files from downloads killed mid-way
(1.6.0 and earlier re-downloaded the model on every server start). 1.6.1's build skips `*.tmp`;
reclaim the space with `rm ~/.semantic-sidekick/models/*/model.onnx.*.tmp`.

**Install (on the air-gapped target):**

```bash
tar -xzf semantic-sidekick-offline-<version>-<sha>-x64.tgz
cd semantic-sidekick-offline-<version>-<sha>-x64
./install-offline.sh
```

Defaults:
- Plugin lands at `~/.semantic-sidekick/plugin/`
- Model cache at `~/.semantic-sidekick/models/`
- HF_HUB_OFFLINE export written to `~/.semantic-sidekick/env.sh` — operator sources it themselves
  (or pass `--persist-rc` to append a sourcing line to `~/.bashrc`)

Install flags:
- `--force` — reinstall same version (no-op otherwise)
- `--force-overwrite-local-edits` — proceed even if existing install has hand-edits
- `--persist-rc` — append `source` line to `~/.bashrc`
- `--prefix DIR` — install root override (testing)
- `--dry-run` — print what would happen, no changes
- `--rollback` — swap `.previous/` back into place
- `--status` — print installed state, no side effects
- `--verify` — exit non-zero if installed state has drifted

**Update flow (every release):**

1. Bump version, commit, build:
   ```bash
   ./scripts/build-offline-tarball.sh
   ```
2. Transport new tarball to target.
3. On target, extract and run `./install-offline.sh`. Behavior:
   - Same version already installed → no-op
   - Different version → atomic swap; previous version preserved at `.previous/`
   - Drift on existing install → refused unless `--force-overwrite-local-edits`

**Rollback** is a single command at the target: `./install-offline.sh --rollback`.

**Drift detection surfaces:**
- Tarball corruption (transport): caught at install time via tarball-level `MANIFEST.json` sha256 verify
- Destination hand-edits: caught pre-swap via plugin-level `MANIFEST.json` sha256 verify
- Post-install integrity: `./install-offline.sh --verify` (cron-friendly, exits non-zero on mismatch)

Glibc baseline confirmed safe for the entire fleet:
- Highest GLIBC symbol required by any native binding is 2.29 (`hnswlib-node`)
- RHEL 9 has 2.34, RHEL 10 / Ubuntu 24.04 have 2.39 — all well above the requirement

See `.planning/offline-packaging/` for the full design doc and diagnostic notes.

## Key Commands

| Command | What It Does |
|---------|-------------|
| `python .claude/project-map/generate.py --force` | Force-regenerate project map |
| `python .claude/project-map/grader.py` | Grade map quality (0-100%) |
| `bash .githooks/install.sh` | (Re)install git hooks |
| `bash .claude/install.sh` | Re-run full plugin installer |

## Dev Credentials

<!-- Add test/dev credentials here (NEVER production secrets) -->

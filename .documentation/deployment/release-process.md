---
title: Release Process
tier: guide
domains:
  - deployment
audience:
  - developers
tags:
  - deployment
  - release
  - npm
  - publish
  - marketplace
  - plugin
  - offline
status: active
last_updated: '2026-10-24'
version: 1.6.1
purpose: How a semantic-memory release goes out — version fields, PR, npm
  publish, the plugin marketplace, the offline tarball, and the checks after
  each
load_priority: 6
estimated_read_time: 2 minutes
word_count: 337
last_validated: '2026-10-25'
backlinks: []
---

# Release process

> One plugin, one repo, one marketplace. The plugin's own marketplace (`semantic-memory-marketplace`, `.claude-plugin/marketplace.json` in this repo) is what `claude plugin update` reads. The central `glitch-kingdom-of-plugins` catalog no longer lists it. The pre-1.0 submodule procedure is archived as `archive/deployment/marketplace-registration.md`.

## 1. Bump the version: five fields

Every release changes all five, or a channel serves a stale version:

| File | Field |
|---|---|
| `package.json` | `version` |
| `.claude-plugin/marketplace.json` | `metadata.version` and `plugins[0].version` |
| `.claude-plugin/plugin.json` | `version` |
| `AGENTS.md` | frontmatter `version` (or regenerate it with `regenerate_contract` from the new build) |

Then:

```bash
npm install --package-lock-only --ignore-scripts   # lockfile root version
npm run build && node dist/cli/index.js --version   # must print the new version
```

Add the `CHANGELOG.md` entry and a `.documentation/changelog/v1-x-y-<slug>.md` doc (via `npx hewtd integrate … --domain changelog -a`).

## 2. Validate

`npm test`, `npm run lint` and `npm run eval` (recall@1 86% / MRR 0.929 on the golden set) must pass. For a release that touches startup, hooks, redaction or packaging, also validate through the real entry points the way the 1.6.1 audit did: a fresh `npm i` of the packed build, a stdio MCP client, the hooks run as processes, and the offline tarball. See `.planning/v161-release-audit/` if it is still present locally.

## 3. PR and merge

One branch and one PR per plan. Push, create and merge as the `TheGlitchKing` gh account, then switch back. Create the PR through the API (`gh api repos/the-glitch-kingdom/semantic-memory/pulls -f title=… -f head=… -f base=main -F body=@file`). Merge only once CI is green.

## 4. Publish to npm

From the merged `main`:

```bash
printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > /tmp/npmrc-publish   # the token stays in the env, never in a file
NPM_CONFIG_USERCONFIG=/tmp/npmrc-publish npm publish --access public          # prepublishOnly builds
rm /tmp/npmrc-publish
```

**The tarball can 404 for several minutes after a successful publish.** `npm view @theglitchking/semantic-memory version` shows the new version at once, but `npm i` of it can fail with `404 Not Found - GET …/-/semantic-memory-x.y.z.tgz` for about 5 minutes while the registry CDN catches up. This is not a failed publish. Poll until it returns 200, and don't republish (npm refuses a version twice anyway):

```bash
until curl -sfo /dev/null -I https://registry.npmjs.org/@theglitchking/semantic-memory/-/semantic-memory-X.Y.Z.tgz; do sleep 30; done
```

Then clear stale npx caches on machines that use `npx …@latest`: `rm -rf ~/.npm/_npx/*/node_modules/@theglitchking`.

## 5. Plugin channel

Installed plugins update from the git marketplace:

```bash
claude plugin marketplace update semantic-memory-marketplace
claude plugin update semantic-memory@semantic-memory-marketplace   # restart Claude Code to apply
```

Check: `claude plugin list` shows the new version, and the installed `hooks/hooks.json` registers SessionStart, UserPromptSubmit, Stop and PostToolUseFailure.

## 6. Offline tarball (when a target needs one)

`./scripts/build-offline-tarball.sh` on the release commit. Expect about 0.55 GB; a much bigger tarball means junk in the model cache (see [troubleshooting](../troubleshooting/troubleshooting.md)). Install and operate it per the offline section of `.claude/rules/operational-runbook.md`. Check `install-offline.sh --verify` exits 0.

## See also

- [CHANGELOG.md](../../CHANGELOG.md)
- [installation-guide.md](../quickstart/installation-guide.md)

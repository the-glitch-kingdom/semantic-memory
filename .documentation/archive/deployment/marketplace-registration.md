---
title: Marketplace Registration
tier: guide
domains:
  - deployment
audience:
  - developers
tags:
  - deployment
  - marketplace
  - npm
  - publish
status: archived
last_updated: '2026-04-23'
version: 0.2.3
purpose: Post-merge steps to register the plugin in glitch-kingdom-of-plugins +
  npm publish
load_priority: 5
archived_on: '2026-10-25'
archived_from: deployment/marketplace-registration.md
archived_reason: One-time v0.2.0 procedure for the central
  glitch-kingdom-of-plugins catalog, which no longer lists this plugin;
  superseded by deployment/release-process.md (v1.6.1 audit)
---

# Marketplace registration

> Steps to add semantic-sidekick to the central `glitch-kingdom-of-plugins` marketplace. Run once, after v0.2.0 is merged to main.

## 1. Add as git submodule

From the `glitch-kingdom-of-plugins` repo:

```bash
cd ~/workspace/the-glitch-kingdom/glitch-kingdom-of-plugins
git submodule add https://github.com/TheGlitchKing/semantic-sidekick.git plugins/semantic-sidekick
git submodule update --init --recursive plugins/semantic-sidekick
cd plugins/semantic-sidekick
git checkout v0.2.0
cd ../..
```

## 2. Add entry to `marketplace.json`

Insert the following object into the `plugins` array in `glitch-kingdom-of-plugins/marketplace.json` (alphabetical order — likely after `semantic-pages`):

```json
{
  "id": "semantic-sidekick",
  "name": "semantic-sidekick",
  "displayName": "Semantic Sidekick",
  "type": "claude-plugin",
  "version": "0.2.0",
  "description": "Activation + routing + capture layer on top of a markdown vault MCP. Hooks search on every prompt; skills route between vault-first / research / outage-silence modes; apply_patch / synthesize_note / ingest_source turn query-answers into durable artifacts with provenance. Turns a retrievable vault into a present knowledge prosthesis.",
  "author": {
    "name": "TheGlitchKing",
    "email": "theglitchking@users.noreply.github.com"
  },
  "repository": {
    "type": "github",
    "owner": "TheGlitchKing",
    "repo": "semantic-sidekick",
    "url": "https://github.com/TheGlitchKing/semantic-sidekick"
  },
  "source": {
    "type": "submodule",
    "path": "./plugins/semantic-sidekick"
  },
  "installation": {
    "methods": [
      {
        "type": "claude-marketplace",
        "command": "/plugin install TheGlitchKing/semantic-sidekick"
      },
      {
        "type": "npm",
        "command": "npm install -g @theglitchking/semantic-sidekick"
      },
      {
        "type": "npx",
        "command": "npx @theglitchking/semantic-sidekick --notes ./vault"
      }
    ],
    "requirements": {
      "node": ">=18.0.0",
      "claude-code": ">=1.0.0"
    }
  },
  "category": "search",
  "tags": [
    "claude-plugin",
    "mcp-server",
    "semantic-search",
    "knowledge-graph",
    "activation-hooks",
    "mode-routing",
    "provenance",
    "vault",
    "markdown"
  ],
  "keywords": [
    "mcp",
    "model-context-protocol",
    "semantic-search",
    "knowledge-graph",
    "markdown",
    "vault",
    "activation",
    "routing",
    "hooks",
    "skills",
    "vault-first",
    "research-mode",
    "outage-silence",
    "provenance",
    "synthesize-note",
    "ingest-source",
    "karpathy-wiki",
    "claude-code",
    "claude"
  ],
  "license": "MIT",
  "homepage": "https://github.com/TheGlitchKing/semantic-sidekick",
  "status": "beta",
  "dependencies": {
    "requires": [],
    "recommends": ["hit-em-with-the-docs", "persistent-planning"],
    "includes": []
  },
  "features": {
    "hooks": ["SessionStart", "UserPromptSubmit", "Stop"],
    "commands": ["/mode", "/vault"],
    "skills": ["vault-first", "research-mode", "outage-silence", "semantic-first"],
    "mcpServers": ["semantic-vault"]
  }
}
```

## 3. Validate

```bash
# From glitch-kingdom-of-plugins root
./scripts/validate-plugins.sh
```

Expected: passes schema validation, recognizes the submodule, finds the plugin manifest.

## 4. Regenerate catalog (if the repo auto-generates it)

```bash
./scripts/generate-catalog.sh
```

## 5. Commit + push

```bash
git add plugins/semantic-sidekick marketplace.json catalog
git commit -m "feat: add semantic-sidekick v0.2.0 plugin"
git push origin main
```

## 6. npm publish (separate repo)

From `semantic-sidekick/`:

```bash
# Verify you're on the tagged release
git checkout v0.2.0

# Dry run first
npm publish --dry-run --access public

# Actual publish
npm publish --access public
```

This makes `npm install -g @theglitchking/semantic-sidekick` and `/plugin install TheGlitchKing/semantic-sidekick` both resolve properly.

## 7. Post-publish sanity

In a fresh Claude Code session, from a test project:

```
/plugin marketplace refresh
/plugin install TheGlitchKing/semantic-sidekick
```

Then verify:

```bash
cat .mcp.json                               # semantic-vault entry added
ls .claude/skills/                          # vault-first, research-mode, outage-silence linked
jq '.hooks | keys' "$CLAUDE_PLUGIN_ROOT/hooks/hooks.json"   # SessionStart, UserPromptSubmit, Stop, PostToolUseFailure (opt-in)
/mode status                                # responds with "current mode: vault-first"
```

All checks pass → plugin is live.

---

## If NPX cache corruption appears post-publish

First reports from the wild might show the `ERR_MODULE_NOT_FOUND` issue that triggered semantic-pages 0.10.0. Users can self-heal:

```bash
npx @theglitchking/semantic-sidekick healthcheck
```

Which auto-detects and clears corrupted npx cache dirs.

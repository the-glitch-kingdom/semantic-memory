---
title: npm 10 audit fix / update crashes on vitest 4's optional peers ("reading 'edgesOut'")
tier: fact
domains:
  - troubleshooting
status: active
last_updated: 2026-10-24
id: npm-10-audit-fix-crashes-on-vitest-4-peers
confidence: medium
last_verified: 2026-10-24
provenance:
  - https://github.com/the-glitch-kingdom/semantic-memory/issues/29
sources:
  - package.json
  - package-lock.json
tags:
  - gotcha
  - npm
  - npm-audit
  - "Cannot read properties of null (reading 'edgesOut')"
invalidated_by:
  - an npm 10 release that fixes arborist #loadPeerSet, or moving the repo to npm 11
---

# npm 10 audit fix / update crashes on vitest 4's optional peers ("reading 'edgesOut'")

## Claim
In this repo, `npm audit fix` and a plain `npm update` under npm 10.9.8 fail with `npm error Cannot read properties of null (reading 'edgesOut')`. The stack is in arborist `build-ideal-tree.js` `#loadPeerSet`, reached while resolving vitest 4.1.x's optional peer dependencies (`@vitest/browser-*`, `jsdom`, `happy-dom`, …). Updating packages by name works as long as vitest is not among them.

## Instead
1. Update the affected packages by name, leaving vitest out: `npm update <pkg> <pkg> …` (transitive names work too).
2. Update the vitest chain with npm 11: `npx -y npm@11 update vitest vite postcss nanoid source-map-js esbuild @vitest/mocker`.
3. npm 11 skips install scripts it hasn't approved and warns about each one (`npm warn install-scripts …`); run `npm rebuild <pkg>` with npm 10 for each.
4. Run the full suite: native modules (`onnxruntime-node`, `sharp`, `hnswlib-node`) are what breaks if a script was skipped.

## How to verify
Not cheaply: reproducing it mutates `package-lock.json`. Check `npm --version` (10.x) and look for `#loadPeerSet` in the `~/.npm/_logs/*-debug-0.log` of the failed run.

## Consequences
The obvious `npm audit fix` is unavailable for this repo on npm 10; the 1.5.2 audit was done by hand as above. Same-major pins in `package.json` `overrides` are the house pattern (v1.5.1, v1.5.2).

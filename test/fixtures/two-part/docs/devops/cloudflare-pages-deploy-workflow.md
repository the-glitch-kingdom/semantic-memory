---
title: Frontend Deploy Workflow (Cloudflare Pages)
tier: standard
feature: devops
domains:
  - devops
  - frontend
audience:
  - all
tags:
  - devops
  - deployment
  - cloudflare
  - frontend
status: complete
last_updated: "2026-06-11"
version: "1.0.0"
purpose: 'Canonical reference for deploying the frontend (marketing site and app
  SPA) to Cloudflare Pages: the two environment projects, manual prod deploy via
  the Deploy Hook script, rollback, env vars and build requirements.'
sources:
  - scripts/deploy-prod-frontend.sh
  - scripts/deploy-staging-frontend.sh
  - frontend/src/config/keycloak.js
  - frontend/src/components/shared/MarketingHeader.jsx
  - frontend/public/_redirects
  - frontend/public/_headers
  - frontend/functions/[[path]].js
  - frontend/package.json
  - keycloak/realms/acme.yaml
  - auth/dev/docker-compose.yml
  - auth/stg/docker-compose.yml
  - auth/stg/keycloak-config/Dockerfile.config
  - .documentation/devops/environments-and-deploy-operator-notes.md
  - .claude/rules/operational-runbook.md
  - .claude/rules/release-workflow.md
last_verified: '2026-11-10'
---

# Frontend Deploy Workflow (Cloudflare Pages)

> The frontend (marketing + app SPA) moved from DigitalOcean App Platform to **Cloudflare Pages**
> on 2026-06-11. This is the canonical deploy reference. Backend stays on DO (separate track).
> Decision + rationale: vault `decisions/cloudflare-pages-frontend-two-projects-by-environment`.

## Architecture: one build, two environment projects

| Project | Custom domain | Env profile | Auto-deploy | Previews |
|---|---|---|---|---|
| `acme-frontend-production` | `acme.example` | prod (`VITE_PUBLIC_MARKETING=true`; auth/API vars added 2026-06-13 — see Env vars) | **OFF** (manual) | OFF |
| `acme-frontend-staging` | `stg.acme.example` | staging (full app/auth/backend env) | **ON** | ON (per-PR) |

- **Same monorepo, same build.** Both Git-connected to `acme-app/acme-app`. Root dir
  `frontend`, build `npm install && npm run build`, output `dist`. They differ only in env vars +
  domain. (Why two projects, not one: Pages' Preview env-var scope is shared, so staging needs its
  own project to keep config distinct from per-PR previews — see the decision note.)
- Cloudflare account `fc27d2f36e4e6f851f653c7dc057fae4`. The docs site (`acme-docs`) is the
  sibling Pages project this setup mirrors.

## How to deploy

- **Staging:** merge to `main` → auto-deploys to `stg.acme.example`. Per-PR pushes auto-build a
  preview URL on the staging project.
- **Production:** auto-deploy is OFF, and a **Git-connected Pages project has NO "Create deployment"
  button** (that is a Direct-Upload-only feature). Trigger a manual prod deploy one of three ways:
  1. **Deploy Hook (canonical).** Dashboard → `acme-frontend-production` → **Settings → Build**
     → **Deploy Hooks** section → click the **`+`** (add) icon → name `prod-manual-deploy`, Branch to
     build `main` → save → it returns a unique URL. POSTing to it builds the latest `main` and
     publishes to `acme.example`. A `prod-manual-deploy` hook (branch `main`) already exists.
     **The hook URL is a SECRET (no auth required) — store it in Vault
     (`secret/acme/prod/.env`, key `CF_PAGES_DEPLOY_HOOK_PROD`) / a password manager, never in
     git.**
     - **Preferred: the wrapper script** `scripts/deploy-prod-frontend.sh` — reads the hook from
       Vault (so the secret never lands in shell history), shows the `origin/main` commit it will
       build, confirms, then fires it. Run `./scripts/deploy-prod-frontend.sh` (or `--dry-run` /
       `--yes` / `--help`). Details below in **Manual prod deploy: the helper script**.
     - Raw fallback (no script): `curl -d "" "<deploy-hook-url>"`.
  2. **Retry deployment (fallback).** Deployments tab → **All deployments** list → a row's `⋯` menu →
     **Retry deployment** (rebuilds that commit). Note: the top "Production" box has only a Details
     link / no `⋯` menu, so retry from the All-deployments list row.
  3. **`wrangler pages deploy`** or the Pages API `POST .../pages/projects/<project>/deployments`.

  This keeps the old `deploy_on_push:false` discipline. **`doctl apps create-deployment` is retired
  for the frontend.**
- **Build watch paths (set in dashboard):** Settings → Builds & deployments → Build watch paths →
  Include `frontend/*`. Without it, ANY merge to `main` (e.g. backend-only) rebuilds the frontend.
  Not settable via API — dashboard only.

## Manual prod deploy: the helper script

**Lives at:** `scripts/deploy-prod-frontend.sh` (repo root `scripts/`).

**What it does:** resolves the secret prod Deploy Hook URL from Vault, prints the `origin/main`
commit that will build, asks for confirmation, then POSTs the hook (which builds `main` HEAD and
publishes to `acme.example`). The secret never appears in args or shell history.

**Where the hook URL comes from (in order):** `$CF_PAGES_DEPLOY_HOOK_PROD` env var → Vault bulk
(`secret/acme/prod/.env`, key `CF_PAGES_DEPLOY_HOOK_PROD`) → Vault legacy → the repo's
**project-root `.env`** (a `CF_PAGES_DEPLOY_HOOK_PROD=...` line; gitignored, only that line is read —
the file is never sourced). Vault is **optional** (skipped if the `vault` CLI is absent); for Vault
you need `VAULT_ADDR` (default `http://localhost:8200`) + a valid token (`vault login`). Storing it
in Vault is preferred for team use; `.env` is the local convenience path.

**Usage:**
```bash
./scripts/deploy-prod-frontend.sh              # show target+commit, confirm, deploy main HEAD
./scripts/deploy-prod-frontend.sh --dry-run    # print what would deploy, fire nothing
./scripts/deploy-prod-frontend.sh --yes        # skip the prompt (CI / non-interactive)
./scripts/deploy-prod-frontend.sh --help       # full built-in help
```

**Discipline:** the hook always builds `main` HEAD, so **merge to `main` first, then run it.** It
does not deploy local/uncommitted code. If the frontend reads a new server field, deploy the backend first or users see
the fallback until it ships. A prod deploy is not finished until it is tagged: run
`./scripts/release/tag-release.sh --note "what shipped"` (the script prints this reminder, then an IndexNow reminder
for Bing). After it fires, watch the build under the project's
**Deployments** tab (~1-3 min); roll back via the section below if needed.

## Manual staging deploy: the helper script

Staging (`acme-frontend-staging` / `stg.acme.example`) **auto-deploys on merge to `main`**,
so a manual trigger is only needed when there is **no new commit** — e.g. after changing the staging
project's build-time `VITE_*` env vars (they only bake in on a fresh build).

**Lives at:** `scripts/deploy-staging-frontend.sh` — identical mechanics to the prod script, just
pointed at the staging project. Hook URL resolution order: `$CF_PAGES_DEPLOY_HOOK_STG` env →
Vault bulk (`secret/acme/stg/.env`, key `CF_PAGES_DEPLOY_HOOK_STG`) → Vault legacy →
project-root `.env`. Same flags (`--dry-run` / `--yes` / `--help`).

**One-time setup:** create the hook in Cloudflare (`acme-frontend-staging` → Settings →
Builds & deployments → Deploy hooks → `+`, branch `main`), then store its URL as
`CF_PAGES_DEPLOY_HOOK_STG` in stg Vault (key in `secret/acme/stg/.env`).

## Rollback

Pages-native one-click rollback is the recovery path for a bad frontend deploy (fast, same
platform). The former DNS-to-DO fallback is **retired** — the DO frontend apps were decommissioned
**2026-06-13** after the soak completed, so Tier 1 is now the only frontend rollback.

### Tier 1 — Pages-native one-click rollback (preferred; instant, no rebuild)
Restores a **prior immutable deployment** as the live production deployment. The custom domain
follows immediately; nothing rebuilds. **Validated 2026-06-11** on staging (rolled back to a prior
deployment and forward to latest `main`; active deployment switched each time in seconds).

- **Dashboard:** Workers & Pages → the project → **Deployments** → pick the last-known-good
  deployment → **⋯ → Rollback** (confirm). For prod (`acme-frontend-production`), this is the
  primary recovery for a bad manual deploy (Deploy Hook trigger).
- **API:**
  ```bash
  # 1. find the last-good deployment id (env=production, newest first)
  curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/<project>/deployments?env=production&per_page=5"
  # 2. roll back to it (creates a new live deployment that is a copy of <good-deployment-id>)
  curl -s -X POST -H "Authorization: Bearer $CF_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/<project>/deployments/<good-deployment-id>/rollback"
  ```
  `<project>` = `acme-frontend-production` or `-staging`. Confirm via the project's
  `canonical_deployment.short_id`. Deployments are immutable, so any prior build is a valid target.

### Tier 2 — DNS rollback to DO — RETIRED (2026-06-13)
The DO `acme-frontend-{production,staging}` App Platform apps were the soak-window fallback
(repoint the apex CNAME back to `acme-frontend-prod-ijyx4.ondigitalocean.app`). They were
**decommissioned/archived 2026-06-13** once the Cloudflare Pages soak completed and then **deleted outright
2026-07-30** (`environments-and-deploy-operator-notes.md`), so this tier no longer exists and cannot be
restored by re-pointing DNS. Use Tier 1 (Pages one-click rollback) — any prior immutable deployment is a valid
target, which covers the bad-deploy case. If Cloudflare Pages itself were ever the problem, recovery
is now via Cloudflare (re-point DNS / Pages support), not DO.

> `.claude/rules/operational-runbook.md` keeps only a one-line summary (Cloudflare Pages one-click
> rollback is the only frontend rollback); the full procedure is Tier 1 above.

## Env vars & secrets

- All `VITE_*` are PUBLIC in the shipped bundle on any platform; the `secret_text`-typed ones
  (`VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_GRAFANA_FARO_URL`) are publishable-by-design keys.
  **Never put a truly-secret value in a `VITE_` var.**
- Each project holds its own env in its **Production** scope; the staging project's **Preview** scope
  feeds per-PR previews. Set in the dashboard (Settings → Environment variables) or the Pages API.
- **Prod auth/API vars (added 2026-06-13, to wire the live Sign In button):** the prod project's
  Production env now sets `VITE_KEYCLOAK_URL=https://auth.acme.example`,
  `VITE_KEYCLOAK_REALM=acme`, `VITE_KEYCLOAK_CLIENT_ID=acme-client`, and
  `VITE_API_BASE_URL=https://api.acme.example`. Without `VITE_KEYCLOAK_URL`, `config/keycloak.js`
  runs in "waitlist-only / skip-SSO" mode and login can't work. Sign In and Get Started
  (`MarketingHeader` + the blog views) both go to live Keycloak: Get Started opens the hosted
  registration page in every environment (`MarketingHeader.jsx` `handleGetStarted`); the old
  `/waitlist` diversion in prod is gone. Setting these was done via the Pages API with a `jq` merge that preserves the
  existing (incl. `secret_text`) vars — the dashboard's per-var add is the safer manual route.

## Previews + Access

- Per-PR previews build on the **staging** project. All `*.pages.dev` URLs (staging + prod) are
  behind **Cloudflare Access** (Google SSO, `@acme.example`), so they're not public/indexable.
  The custom domains (`acme.example` public, `stg.acme.example` Access-gated) are separate
  Access apps.
- **Keycloak + preview URLs:** auth now works on staging `*.pages.dev` previews. The
  `acme-client` in `keycloak/realms/acme.yaml` allowlists
  `https://*.acme-frontend-staging.pages.dev/*` (redirectUri + CORS webOrigin). This realm is
  loaded by the keycloak-config container (mounts `keycloak/realms` → preprocess-realms.sh →
  keycloak-config-cli), so a realm change applies on the next **keycloak-config reload** on the
  auth-staging droplet. → vault `gotchas/keycloak-redirect-uri-cloudflare-pages-previews`.

## Two non-obvious build requirements (do not revert)

1. **Flat per-route HTML.** `inject-route-meta.mjs` emits `dist/<route>.html` (NOT
   `<route>/index.html`). Pages serves `dist/foo.html` at the no-slash `/foo` (200), matching our
   `<canonical>` + sitemap + GSC-indexed URLs. The directory form makes Pages 308-redirect `/foo` →
   `/foo/`, breaking canonical parity on every indexed page.
2. **Sitemap/llms are static now.** `acme.example/sitemap.xml` + `/llms.txt` are the build's
   static `dist/` files served by Pages (the `acme-sitemap` Worker was retired; its routes
   deleted). To change URLs: edit the manifest + redeploy. `_redirects` (`/* /index.html 200`, below the 301 SEO migrations)
   provides the SPA deep-link fallback, and `frontend/functions/[[path]].js` turns an unknown HTML path into a real 404
   (known routes come from `functions/_route-manifest.mjs`); `_headers` provides asset caching (NO `noindex` — that file
   is shared by both projects; prod must stay indexable).

## Related

- Decision: vault `decisions/cloudflare-pages-frontend-two-projects-by-environment`
- SEO/sitemap: `.documentation/marketing/sitemap-generation.md`, `seo-surface-implementation.md`
- Marketing per-env data: `.documentation/revops/marketing-data-per-environment-isolation.md` (now a **backend** `MARKETING_DATABASE_URL` concern; the `VITE_SUPABASE_WAITLIST_*` vars are retired and their keys deleted — GH #1253)

> ⚠ **Vite inlines the WHOLE `import.meta.env` object**, so a `VITE_*` var that no code reads is
> still published in the JS bundle. `VITE_SUPABASE_WAITLIST_ANON_KEY` shipped a working database
> credential to every visitor for months after the code using it was deleted. **Remove unused
> `VITE_*` vars from the Pages project** rather than leaving them set.
>
> Also: **an unchanged asset hash means your change did not take.** A deploy can report
> `build: success` and still serve identical assets if it raced an env-var edit. Confirm
> `/assets/index-<hash>.js` actually changed before believing a var was removed.
- Operational runbook: `.claude/rules/operational-runbook.md` → "Deploys" (a stub that links back here)

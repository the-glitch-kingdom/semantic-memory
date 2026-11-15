---
title: 'Environments, Deploys and Vault: Operator Notes'
tier: reference
domains:
  - devops
audience:
  - developers
  - devops
  - admin
tags:
  - api
  - database
  - docker
  - python
  - fastapi
  - migration
  - deployment
status: active
last_updated: 2026-10-01
version: 1.0.0
purpose: 'Documentation for environments, deploys and vault: operator notes'
estimated_read_time: 6 minutes
word_count: 1120
last_validated: 2026-10-01
backlinks: []
sources:
  - .claude/rules/operational-runbook.md
  - .digitalocean/app-production.yaml
  - .digitalocean/app-staging.yaml
  - .documentation/marketing/sitemap-generation.md
  - backend/migrations/env.py
  - frontend/scripts/snapshot-routes.mjs
  - scripts/deploy-prod-frontend.sh
  - scripts/vault/migrate-per-variable-to-bulk.sh
  - workers/stg/scripts/init-workers.sh
last_verified: '2026-11-09'
---

# Environments, Deploys and Vault: Operator Notes

> Moved verbatim on 2026-10-01 from the auto-loaded `.claude/rules/` files, which had grown past Claude Code's 150k-char instruction limit. This doc holds the environment table, live-infra history, deploy procedures, key commands and Vault schema; the rules files keep only a stub with the traps and a link here. Keep this doc as the source of truth and update the stub only when a trap is added or retired.

## Environment Differences

| | Dev | Staging | Production |
|---|---|---|---|
| **URL** | http://localhost | https://stg.acme.example | https://acme.example |
| **Database** | Local PG or Supabase | Supabase `acme-stg` (pooler) | Supabase `acme-prod` (app + marketing); Keycloak on `acme-prod-auth` |
| **Deploy** | docker-compose | FE: Cloudflare Pages (auto on merge); BE: DO App Platform | FE: Cloudflare Pages (manual deploy hook); BE: DO App Platform (manual) |
| **Secrets** | Vault → .env | Vault → .env.staging | Vault → .env.prod |
| **Auth droplet** | Local (docker) | DO `auth-staging` / tailnet `auth-staging-1`, `s-2vcpu-4gb-amd` (4GB) | `auth-production` (DO and tailnet), 8GB/4vCPU |
| **Workers droplet** | Local (docker) | DO `workers-staging` / tailnet `workers-staging-1`, `s-4vcpu-8gb` (8GB/4vCPU, resized 2026-07-04 for the #675 dedicated cache worker) | `workers-production` (DO and tailnet), 8GB/4vCPU |
| **App Platform** | — | backend `acme-backend-staging` `basic-m` (`.digitalocean/app-staging.yaml`) | backend `acme-backend-production` → `api.acme.example` |
| **Migrations** | Auto (init container) | PRE_DEPLOY job | PRE_DEPLOY job |
| **Admin access** | Keycloak :8080 | Tailscale VPN | Tailscale VPN |

> **Live infra (frontend on Cloudflare Pages since 2026-06-11; DO frontend apps DELETED 2026-07-30)**:
> Production frontend (`acme.example`) + staging (`stg.acme.example`) are served by
> **Cloudflare Pages** (two env projects, one build). The old DO
> `acme-frontend-{production,staging}` App Platform apps were the soak-window rollback. They
> were archived 2026-06-13/14 (`maintenance.archive: true`, last deployment cause literally
> `app spec updated, app archived`) and **DELETED outright on 2026-07-30** — frontend rollback is
> Cloudflare Pages one-click only (the DNS-to-DO tier no longer exists).
> **DO App Platform now hosts ONLY the two backends** (`acme-backend-{production,staging}`);
> if you see a frontend app there, someone recreated it.
> Deletion was verified safe first: authoritative NS for `acme.example` is Cloudflare
> (`dee`/`derek.ns.cloudflare.com`), and the vestigial DO DNS zone for that domain holds **only SOA +
> its own NS records** — zero A/CNAME — so no DNS could break. Both apps still listed
> `acme.example` / `stg.acme.example` as PRIMARY domains in their specs right up to deletion;
> that claim was dormant, not active.
> ⚠ **Reading an App Platform app's liveness: use the DEPLOYMENT HISTORY, not `updated_at` or
> `active_deployment.phase`.** Both of those lie on an archived app — `updated_at` moves for API
> metadata reasons (it read as *today* on apps last deployed in June), and the archiving deployment
> itself sits there as `phase: ACTIVE` forever. `doctl apps list-deployments <id>` is the field that
> actually answers it.
> **Production backend is now live** (added during the prod-launch epic): DO App Platform
> `acme-backend-production` → `api.acme.example`, plus `auth-production`
> (Keycloak + Vault) and `workers-production` (Celery + Redis) droplets. The prod app datastore is
> **Supabase `acme-prod` (`projrefaaaaaaaaaaaaa`, us-west-1)**; Keycloak moved to its own
> project `acme-prod-auth` on 2026-08-29 (GH #1447); still **no DO
> managed DB**. `workers-staging` was resized 2GB→4GB on 2026-05-02, then **4GB→8GB/4vCPU on
> 2026-07-04** for the #675 national-cache dedicated `property_cache` worker (fan-out at `-c 6`).
> (The earlier "all staging" DO
> spend figure predates the prod backend + droplets and is now higher.)

**Dev env file**: `.env` (NOT `.env.dev`) — Vault init container loads from `.env`

**CRITICAL**: Never use Supabase transaction pooler port `6543` for migrations — always port `5432` (session mode).

---

## Deploy Procedures

> **Contract**: [`release-workflow.md`](../../.claude/rules/release-workflow.md). Always staging → **verify** → prod,
> check for Alembic migrations in the delta first (they run PRE_DEPLOY, so old code meets the new
> schema), and **tag the release** afterwards with `./scripts/release/tag-release.sh`. An untagged
> prod deploy leaves no rollback target.


**Dev**: `docker compose up -d` (or `./scripts/start-dev.sh --fast`)

**Frontend (Cloudflare Pages — migrated off DO App Platform 2026-06-11)**:
- Two Pages projects, ONE build, split by ENVIRONMENT: `acme-frontend-production`
  (`acme.example`) and `acme-frontend-staging` (`stg.acme.example`). Git-connected
  to this monorepo (root dir `frontend`, build `npm install && npm run build`, output `dist`).
- **Staging**: auto-deploys on merge to `main`. **Prod**: auto-deploy OFF. A Git-connected Pages
  project has **NO "Create deployment" button** (Direct-Upload only). Manual prod deploy = the
  **Deploy Hook** (Settings → Build → Deploy Hooks → `+` icon → name + branch `main` → unique URL;
  POST builds latest `main`). A `prod-manual-deploy` hook exists; its URL is a **secret** (store in
  Vault at `secret/acme/prod/.env/CF_PAGES_DEPLOY_HOOK_PROD`, not git).
  **Run `./scripts/deploy-prod-frontend.sh`** (resolves the hook from `$CF_PAGES_DEPLOY_HOOK_PROD` →
  Vault → project-root `.env`, confirms, fires; `--dry-run` / `--yes` / `--help`) — preferred over a
  raw `curl -d "" "<hook-url>"`.
  Fallbacks: Deployments → All deployments → row `⋯` → **Retry deployment**; or `wrangler pages
  deploy` / Pages API `POST .../deployments`. `doctl apps create-deployment` is RETIRED for the FE.
- **Rollback (frontend)** — Cloudflare Pages one-click (validated 2026-06-11; the only tier since
  the DO frontend apps were archived 2026-06-13):
  - **Pages one-click (instant, no rebuild)**: dashboard → the project →
    Deployments → last-good deployment → ⋯ → **Rollback**. Or API: `POST .../pages/projects/<project>/deployments/<good-deployment-id>/rollback`
    (find `<good-deployment-id>` via `GET .../deployments?env=production&per_page=5`; confirm with the
    project's `canonical_deployment.short_id`). Deployments are immutable, so any prior build is a
    valid target — this covers the bad-deploy case.
  - **DNS-to-DO tier — RETIRED 2026-06-13, and now IMPOSSIBLE (apps deleted 2026-07-30)**: the old
    fallback (repoint the apex CNAME to `acme-frontend-prod-ijyx4.ondigitalocean.app`) is
    gone — that hostname no longer resolves to anything, because the app behind it was deleted, not
    merely archived. If Cloudflare Pages itself were ever the problem, recover via Cloudflare, not
    DO. Re-creating a DO frontend from scratch is a rebuild, not a rollback; don't plan on it.
  - Full steps: `.documentation/devops/cloudflare-pages-deploy-workflow.md` → Rollback.
- Per-PR previews live on the staging project, behind Cloudflare Access (`@acme.example` SSO);
  prod `*.pages.dev` is Access-gated too (apex stays public). Set **Build watch paths =
  `frontend/*`** (dashboard, Settings → Builds) so backend-only merges don't rebuild the frontend.
- The prerender step (`inject-route-meta.mjs`) emits **flat `dist/<route>.html`** (NOT
  `<route>/index.html`) so Pages serves no-slash URLs directly — matching canonical/sitemap; the
  directory form makes Pages 308-redirect to a trailing slash (canonical mismatch). Don't revert it.
- → full guide: `.documentation/devops/cloudflare-pages-deploy-workflow.md`.

**Backend (DO App Platform — staging `5dbe35de-…`, production `78ecaa31-…`; full IDs in `release-workflow.md`)**:
```bash
doctl apps list                              # Get app IDs
doctl apps create-deployment <app-id>        # Trigger deploy (manual only)
```

**Staging/Production (Droplets)**:
```bash
tailscale up                                 # Connect VPN
ssh root@auth-staging-1                      # SSH to droplet (also workers-staging-1, auth-production, workers-production)
cd /path/to/config && ./deploy.sh            # Run deploy script
```

- ⚠ **The workers droplet is a separate deploy target** for Celery code (emails, Zoho push, scans, tier enforcement). A backend-only deploy does not update it. `./deploy.sh` on the droplet now pulls itself; confirm with `git log --oneline -1`. **Never `docker compose down`** on a droplet: tailscale is in that compose file and your SSH dies.
- ⚠ **Deploy the backend BEFORE the frontend** when the frontend reads a new server field, or users see the fallback (for `budget_total`, $0) for the length of the gap.

---

## Key Commands

```bash
# Dev lifecycle
./scripts/start-dev.sh --fast              # Start all (skip health waits)
./scripts/stop-dev.sh                      # Graceful shutdown
./scripts/restart-dev.sh                   # Full restart
docker compose ps                          # Status

# Frontend
cd frontend && npm run dev                 # Start dev server (HMR works on native Linux)

# Database
/switch-database local|supabase|status     # Hot-reload switch (no restart needed)
# ⚠ env.py prefers ALEMBIC_DATABASE_URL (dev Supabase over 6543) over DATABASE_URL, so a plain
# `alembic upgrade head` migrates the wrong DB. Point it at the app DB explicitly:
docker exec acme-fastapi sh -lc 'ALEMBIC_DATABASE_URL="$DATABASE_URL" alembic upgrade head'
docker exec acme-fastapi sh -lc 'ALEMBIC_DATABASE_URL="$DATABASE_URL" alembic revision --autogenerate -m "msg"'   # same ALEMBIC_DATABASE_URL trap as above

# Keycloak config (apply realm YAML changes)
docker compose -f auth/dev/docker-compose.yml restart keycloak-config

# Keycloakify theme (rebuild after editing keycloakify/src/ or keycloak/providers/)
# The keycloakify-builder runtime container was removed (April 2026); the theme +
# custom SPIs are now baked into a multi-stage image via docker/keycloak/Dockerfile.
./scripts/build-keycloak-image.sh
docker compose -f auth/dev/docker-compose.yml up -d --force-recreate keycloak
# Then reload nginx if the proxy needs to re-resolve the container:
docker exec acme-nginx nginx -s reload

# Code quality
./.claude/scripts/run-checks.sh --fix      # Auto-fix lint violations
source .venv/bin/activate && ruff check backend/ --fix
cd frontend && npm run lint -- --fix

# Vault — ONE PATH PER SECRET. This is the only schema (see Known Issues).
export VAULT_ADDR=http://localhost:8200            # dev Vault; stg/prod run on their auth droplets
# No host `vault` binary (verified 2026-10-01): run these as `docker exec acme-vault vault ...`, or use the HTTP API.
vault kv list secret/acme/dev/.env/         # list every secret name
vault kv get  secret/acme/dev/.env/OPENAI_API_KEY   # read one -> {value: ...}

# Add/update a secret (the name MUST match the canonical env var exactly):
vault kv put secret/acme/dev/.env/ZOHO_API_CLIENT_ID value=xxxxx

# There is no bulk/single-object schema and no migration tool. Both
# scripts/vault/migrate-per-variable-to-bulk.sh and upload-env-to-bulk.sh now
# REFUSE TO RUN: writing a bulk object shadows the real per-variable secrets.
```

---

## Python Environment

**Always use `.venv/`** at project root — never system Python:
```bash
source .venv/bin/activate         # Or: .venv/bin/python3 script.py
```

---

## Known Issues

- **Vault graceful degradation**: Vault-first → falls back to `.env` if unavailable.

- **Read a container's live env off PID 1** (`tr "\0" "\n" < /proc/1/environ` inside the container), never `docker exec printenv`: an exec session does not carry the PID 1 environment.

- **Vault uses ONE PATH PER SECRET. The bulk schema is retired (2026-07-19)**: every secret lives at `secret/acme/{env}/.env/{VAR_NAME}` holding `{value: ...}`. The single-object "bulk" layout from GH #471 (all ~100 pairs inside one KV entry at `acme/{env}/.env`) **was retired and is not coming back**. No environment has a bulk object; dev has ~130 per-variable keys, stg loads 103 the same way, prod likewise. `config.py::_from_vault` reads per-variable, so the app has always agreed with reality.
  - **What this bullet used to say was wrong**, and the code matched the wrong version: all five startup scripts (`scripts/init-acme.sh`, `workers/{stg,prod}/scripts/init-workers.sh`, `backend/scripts/digitalocean_{stg,prod}/do-start.sh`) read bulk FIRST and logged `WARN: Falling back to per-variable schema` when they took the correct path. Every service, every environment, every boot warned about doing the right thing. Fixed: per-variable is now the only path and the warning is gone.
  - **Why writing a bulk object was dangerous**: the bulk loader returned success on `count > 0`. A bulk object holding even ONE key would win outright and the other ~100 secrets would never load. `REQUIRED_VARS` hard-fails the container on a handful of them, so it could not ship silently broken, but the cause would be baffling. `scripts/vault/migrate-per-variable-to-bulk.sh` and `scripts/vault/upload-env-to-bulk.sh` now **refuse to run** and explain why.
  - **Adding a secret**: write the per-variable path, and the key name must match the canonical env var exactly (`ZOHO_API_CLIENT_ID`, not `ZOHO_CLIENT_ID`). Each script's `REQUIRED_VARS` array hard-fails container start if a listed key is missing, which is what stops a new secret being silently dropped.
  - **Still bulk-first, harmless, not yet cleaned up**: `scripts/env-keys.sh`, `scripts/deploy-{staging,prod}-frontend.sh` try bulk then fall back. They are interactive tooling, they degrade correctly, and with both writers neutralised no bulk object can exist for them to prefer.

- **S3 vars must be set manually in DO dashboard**: `AWS_S3_REGION`, `AWS_S3_BUCKET`, `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY` are defined as `type: SECRET` in `app-staging.yaml` / `app-production.yaml` but are NOT auto-populated — they must be set in the App Platform UI (Settings → Environment Variables). Staging bucket: `acme-staging`, region: `us-west-1`. Missing these causes `No host specified` errors when uploading template workspace images on new user registration.
- **Prod `sitemap.xml` + `llms.txt` are STATIC Cloudflare Pages files** (since the 2026-06-11 Pages migration; the `acme-sitemap` Worker was RETIRED — routes deleted). They're built at frontend build time by `frontend/scripts/generate-sitemap.mjs` + `generate-llms-txt.mjs` into `dist/` and served directly by Pages. To change which URLs appear: edit the marketing manifest (`frontend/src/features/marketing/manifest/`) + redeploy the frontend (prod = manual Deploy Hook, see Deploy Procedures). Sitemap is `<loc>`-only (future-dated `lastmod` + `changefreq`/`priority` are GSC-rejected). The `draft`/`noindex` flags exclude routes (off-sitemap, off-llms, robots noindex). → `.documentation/marketing/sitemap-generation.md` + `.documentation/marketing/seo-surface-implementation.md`.
  - **Draft/noindex exclusion has THREE build-script consumers** that produce the served artifacts: `generate-sitemap.mjs`, `inject-route-meta.mjs` (per-route robots meta), `generate-llms-txt.mjs`. Keep them consistent when changing exclusion logic. (`generate-articles-manifest.mjs` still emits `articles.json`, which fed the now-retired Worker; keep it draft-correct for hygiene but it's no longer load-bearing for prod. `snapshot-routes.mjs` is dead code.) **Verify a manifest-logic change against the live prod sitemap after deploy.** History: PR #684 fixed a draft leak (49 vs 46) when the Worker still served prod.

## Dev Credentials

- **Test account**: user@example.com / <test-password>
- **MFA test account**: user@example.com / <test-password>

---

## Navigation

- **Always use `http://localhost`** for browser/Playwright (not direct ports)
- API Docs: http://localhost/api/docs
- Keycloak: http://localhost/auth (via nginx proxy)
- Mailpit: http://localhost:8025

---

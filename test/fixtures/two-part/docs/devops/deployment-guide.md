---
title: Deployment Guide
tier: guide
feature: null
domains:
- devops
- backend
- database
- security
audience:
- all
tags:
- devops
- deployment
- migration
- infrastructure
status: complete
last_updated: '2026-08-09'
version: 1.0.0
size_kb: 23.1
line_count: 891
complexity: medium
read_time_min: 20
load_priority: 2
chunk_strategy: section
keywords:
- ai
- api
- database
- deployment
- docker
dependencies: []
related: []
supersedes: []
summary: Documentation for deployment guide covering ai, api, database
owner: team
sources:
- docker-compose.yml
- .claude/rules/operational-runbook.md
- .claude/rules/release-workflow.md
- .digitalocean/app-production.yaml
- .digitalocean/app-staging.yaml
- .github/workflows/_deploy.yml
- .github/workflows/deploy-backend-production.yml
- backend/app/auth/router.py:633,681
- backend/app/main.py:140
- backend/app/routers/health.py
- backend/migrations/env.py:17-24
- backend/scripts/digitalocean_prod/do-migrate.py
- backend/scripts/digitalocean_stg/do-migrate.py
- scripts/deploy-prod-frontend.sh
- scripts/init-acme.sh:125,162
- scripts/release/tag-release.sh
last_verified: '2026-11-10'
purpose: Deploy procedure for staging and production (DO App Platform backend,
  Cloudflare Pages frontend, droplets), verification, tagging and rollback.
---

# Acme Deployment Guide

**How Acme is deployed to staging and production, and how to roll back.** The backend runs on
DigitalOcean App Platform, the frontend on Cloudflare Pages, and auth and Celery workers on droplets.
This guide was rewritten on 2026-11-09: the earlier version described a generic self-hosted
docker-compose / Kubernetes deployment (`docker-compose.staging.yml`, `docker-compose.prod.yml`, an SSH
deploy host, an nginx load balancer) that Acme never ran. The only compose file in the repo is the
dev-only `docker-compose.yml`.

Authoritative companions: `.claude/rules/release-workflow.md` (the model and the tagging rule),
`.claude/rules/operational-runbook.md` (env table, key commands),
[Environments and deploy operator notes](environments-and-deploy-operator-notes.md),
[Cloudflare Pages deploy workflow](cloudflare-pages-deploy-workflow.md),
[Production backend deployment](production-backend-deployment.md),
[Droplet deployment](droplet-deployment.md) and [Database migration workflow](../procedures/database-migration-workflow.md).

---

## The model

```
branch -> PR -> CI green -> merge to main -> deploy staging -> VERIFY -> deploy prod -> TAG
```

Trunk-based: there is no `dev` or `release` branch, and staging deploys from `main`. Both backend
environments are deployed **manually on purpose**. Always staging, then verify, then prod; never both at
once.

| | Backend | Frontend |
|---|---|---|
| **Staging** | `doctl apps create-deployment 606b6d93-5c8e-2857-a09b-05a0ff54b9d0` | auto on merge to `main` (Cloudflare Pages) |
| **Production** | `doctl apps create-deployment 53769b69-0720-409e-277c-190c04ab0077` | `./scripts/deploy-prod-frontend.sh` (`--dry-run` first) |

Auth (Keycloak) and the Celery workers run on droplets, a **separate deploy target**: a backend-only deploy
does not update workers code. See the workers and Keycloak sections of the operational runbook, and never
`docker compose down` on a droplet (tailscale is in that compose file and your SSH dies).

## Pre-deployment checklist

- CI green on the PR; the pre-push hook (`scripts/ci/guards.sh`, gimme-the-lint, contract check) is the real gate.
- Migrations: `git diff --name-only <live-sha>..main -- backend/migrations/versions/`. Migrations run as a
  PRE_DEPLOY job, so for a window **the old code queries the new schema**; the change must be backward
  compatible (expand and contract in separate deploys).
- Secrets: a new env var must be declared everywhere it is read (Vault key, `REQUIRED_VARS` in the startup
  scripts, workers compose). See the operational runbook.
- Deploy the **backend before the frontend** when the frontend reads a new server field.

## Deploy the backend (staging, then production)

DO App Platform builds the backend from `backend/Dockerfile` on its own infrastructure. There is no local
build/start sequence. The `db-migrate` job (`kind: PRE_DEPLOY`, `backend/scripts/digitalocean_prod/do-migrate.py`; staging uses `backend/scripts/digitalocean_stg/do-migrate.py`,
declared in `.digitalocean/app-production.yaml`; the staging spec is `.digitalocean/app-staging.yaml`) runs
Alembic before the new code goes live.

```bash
doctl apps create-deployment <app-id>            # ids in the table above
doctl apps list-deployments <app-id>             # liveness: read deployment history, never updated_at/phase
doctl apps logs <app-id> backend --type deploy --deployment <id> | grep -i success   # migrate job + secret load
```

`ACTIVE` only means the container started and passed a health check. Verify before promoting to prod:

```bash
curl -s https://acme-backend-staging-abcde.ondigitalocean.app/api/health/deep   # staging
curl -s https://api.acme.example/api/health/deep                                   # prod
```

The real health routes are `/api/health` and `/api/health/deep` (DB, Redis, Qdrant; `backend/app/routers/health.py`).
Also check the secret-load line in the deploy logs (a drop in the count means secrets went missing) and that
authenticated routes return **401, not 500**. Do not smoke-test retired endpoints (`/api/v1/auth/signup` and
`/api/v1/auth/register` return `410 Gone`).

Never `doctl apps update --spec` from a `spec get` dump: it drops the VPC and secrets. Use `create-deployment`.

**GitHub Actions buttons.** The same deploy can be run from Actions: `deploy-backend-staging.yml`, `deploy-backend-production.yml` (type `DEPLOY` to confirm) and `deploy-frontend-production.yml`. All are `workflow_dispatch` only and call the reusable `.github/workflows/_deploy.yml`, which refuses to run from any branch but `main` (DigitalOcean and Cloudflare build `main` whatever branch you pick), runs `doctl apps create-deployment` (never `apps update --spec`), polls to `ACTIVE`, then requires `/api/health/deep` to report healthy and records a GitHub Deployment. It does not tag the release; run `tag-release.sh` afterwards. See [CI/CD workflow guide](cicd-workflow-guide.md).

## Deploy the frontend

Staging is automatic on merge. Production is a manual Cloudflare Pages deploy hook:
`./scripts/deploy-prod-frontend.sh` (`--dry-run` first; the hook URL is a secret). Frontend rollback is the
Cloudflare Pages one-click only. Details: [Cloudflare Pages deploy workflow](cloudflare-pages-deploy-workflow.md).

## Tag every production deploy

A production deploy is not finished until it is tagged; the tag is the rollback target.

```bash
./scripts/release/tag-release.sh --note "what shipped, in a few words"
./scripts/release/tag-release.sh --dry-run          # preview, creates nothing
./scripts/release/tag-release.sh --commit <sha>     # tag retroactively
```

Tags are `prod-YYYY-MM-DD` (`.2` for a second deploy the same day). The script refuses a commit that is not
an ancestor of `origin/main` and prints the previous tag (the rollback target) first.

## Database migrations

Migrations run automatically as the `db-migrate` PRE_DEPLOY job; locally the init container runs them.
Never use the Supabase transaction pooler (port 6543) for DDL; use 5432 (session mode). For authoring,
the dev-DB `ALEMBIC_DATABASE_URL` trap and the marketing and cache Alembic environments, see
[Database migration workflow](../procedures/database-migration-workflow.md).

Migrations are hand-written: `--autogenerate` is disabled on purpose (`backend/migrations/env.py`, GH #1143: it would emit a migration that drops every table). Create one with `docker compose exec fastapi alembic revision -m "name"` and fill in `upgrade()` / `downgrade()` by hand. Locally the unified `init` container (`scripts/init-acme.sh`, waits up to 30 x 2s for Postgres) applies them; check with `docker compose logs init`, re-run with `docker compose up init`.

## Rollback

There is **no artifact promotion**: staging and production each build their own image from the same commit,
so rollback means redeploying a previously tagged commit, not pulling a cached image.

```bash
git tag --list 'prod-*' --sort=-creatordate | head -5     # find the rollback target
git diff prod-<prev>..prod-<current> --stat               # what the bad release shipped
```

Redeploy by putting the previous tag's code on `main` through the normal PR path (a revert PR), then
`doctl apps create-deployment <app-id>` and verify `/api/health/deep`. For a failed migration, do not
patch with direct SQL: ship a forward migration that reverses the change. A Supabase restore is a
whole-project rollback (as of 2026-08 PITR was off on the prod app project and backups rolled off after 7 days; re-check before relying on it). Frontend:
Cloudflare Pages one-click rollback.

## Monitoring and incidents

Observability is Grafana Cloud (Alloy to Loki/Prometheus), Sentry and PostHog; see
[Grafana alerts runbook](grafana-alerts-runbook.md) and the monitoring reference. The backend (App Platform)
ships no logs to Loki, so read backend logs with `doctl apps logs <app-id> backend --type run --follow`.
Incident handling and postmortems: [Operations guide](operations-guide.md).

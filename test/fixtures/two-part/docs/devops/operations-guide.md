---
title: Operations Guide
tier: guide
feature: null
domains:
  - devops
  - database
  - security
audience:
  - all
tags:
  - devops
  - operations
  - monitoring
  - guide
status: complete
last_updated: '2026-07-20'
version: 1.2.0
size_kb: 40
line_count: 1400
complexity: medium
read_time_min: 18
load_priority: 2
chunk_strategy: section
keywords:
  - operations
  - maintenance
  - monitoring
  - scaling
  - troubleshooting
dependencies:
  - devops/multi-environment-guide.md
related:
  - devops/cicd-workflow-guide.md
  - database/provider-switching.md
  - security/vault-migration.md
supersedes: []
summary: Daily operations, maintenance procedures, runbooks, and monitoring for Acme platform (including frontend and backend)
owner: team
purpose: 'Day-to-day operating procedures for the dev stack, the staging and
  production backends and droplets: checks, service control, migrations,
  rollback and logs.'
sources:
  - .claude/rules/operational-runbook.md
  - .claude/rules/release-workflow.md
  - .documentation/devops/environments-and-deploy-operator-notes.md
  - .github/workflows/_deploy.yml
  - README.md
  - auth/dev/docker-compose.yml
  - auth/stg/deploy.sh
  - auth/stg/docker-compose.yml
  - backend/app/config.py
  - backend/app/routers/health.py
  - backend/migrations/env.py
  - docker-compose.yml
  - frontend/package.json
  - frontend/vite.config.ts
  - scripts/restart-dev.sh
  - scripts/start-dev.sh
  - scripts/stop-dev.sh
  - storage/dev/docker-compose.yml
  - workers/dev/docker-compose.yml
  - workers/prod/deploy.sh
  - workers/stg/deploy.sh
  - workers/stg/docker-compose.yml
last_verified: '2026-11-10'
---

# Operations Guide: Acme Platform Management

This guide covers daily checks, service management, database operations, rollback and log access for the dev, staging and production environments. It is the how-to layer: the environment table, key commands and traps live in `.claude/rules/operational-runbook.md`, the deploy flow in `.claude/rules/release-workflow.md` and [environments-and-deploy-operator-notes.md](environments-and-deploy-operator-notes.md), and subsystem traps (RLS, account deletion, contract engine, CI) in [platform-subsystem-operator-notes.md](platform-subsystem-operator-notes.md).

> **Rewritten 2026-11-09.** The previous text predated the Cloudflare Pages frontend, per-variable Vault, the `-1` tailnet hostnames and the self-pulling `deploy.sh`. Removed because they described things that do not exist: the `platform-admin-ui` service on :3001, `doctl apps run`, `doctl apps create-deployment --deployment-id`, `scripts/digitalocean_{stg,prod}/do-migrate.py` and `scripts/health-check.sh`.

---

## Daily Operations

### Development checks

- Containers up and healthy: `docker compose ps` (root stack) and `docker ps --filter health=unhealthy`.
- Vite running: `pgrep -af vite`. Frontend via nginx: `curl http://localhost/` (HTML).
- API: `curl http://localhost/api/health` returns `{"status":"healthy","env":...,"version":...}`. `curl http://localhost/api/health/deep` also reports database, Redis and Qdrant (`healthy` / `degraded` / `unhealthy`).
- Logs: `docker compose logs --since=12h --tail=100 fastapi`.

### Staging / production checks

- Backend: `curl https://stg-api.acme.example/api/health/deep` and `curl https://api.acme.example/api/health/deep`. `ACTIVE` in App Platform only means the container started; also read `doctl apps list-deployments <app-id>` (never `updated_at` / `phase`).
- Droplets (tailnet names, note the `-1`): `ssh root@auth-staging-1`, `ssh root@workers-staging-1`, `ssh root@auth-production`, `ssh root@workers-production`, then `docker compose ps`. The DO droplet names `auth-staging` / `workers-staging` do not resolve on the tailnet.
- Supabase connection counts: Supabase dashboard, Database.
- Celery queue depth: on the workers droplet, `docker compose exec redis redis-cli llen celery` (authenticate if the Redis secrets file sets a password).

### Weekly / monthly

Review Supabase size and connection use, Qdrant collection sizes, S3 bucket sizes, failed Celery jobs (`docker compose exec celery-worker celery -A app.celery_app inspect stats`), DigitalOcean billing, and Dependabot PRs. Vault and Keycloak procedures are in the linked operator notes; schedules for Vault snapshots and AppRole rotation were not verified from this repo.

---

## Service Management

### Development

The dev stack is four layers, each its own compose file: **storage** (`storage/dev`: postgres, qdrant, minio), **auth** (`auth/dev`: vault, keycloak, keycloak-config), **workers** (`workers/dev`: init, redis, celery-worker, celery-beat, celery-exporter) and **app** (root `docker-compose.yml`: fastapi under the `backend` / `all` profile, nginx). Dev ports bind `127.0.0.1` except nginx on :80.

```bash
./scripts/start-dev.sh [--fast] [--layer=storage|auth|workers|app]
./scripts/stop-dev.sh  [--layer=<name>]
./scripts/stop-dev.sh --clean        # DELETES ALL DATA; you must type "DELETE ALL DATA"
./scripts/restart-dev.sh [--fast] [--layer=<name>]
```

By hand, in layer order:

```bash
docker compose -f storage/dev/docker-compose.yml up -d
docker compose -f auth/dev/docker-compose.yml up -d vault keycloak
docker compose -f auth/dev/docker-compose.yml up keycloak-config   # one-shot
docker compose -f workers/dev/docker-compose.yml up -d
docker compose --profile all up -d
```

Restart one service with `docker compose restart <service>`, but a **plain `restart` does not re-read env files**; after an env change use `docker compose up -d --force-recreate <service>`. See [provider-switching.md](../database/provider-switching.md).

### Development: frontend

The frontend runs on the host, not in a container. Always browse `http://localhost` (nginx on :80 proxies to Vite on :5173).

```bash
cd frontend && npm run dev          # script is `vite`; server.host is 0.0.0.0 in vite.config.ts, so no --host flag is needed
npm run build && npm run preview    # production build check
pkill -f vite                       # stop
```

| Symptom | Cause | Fix |
|---|---|---|
| 502 Bad Gateway at http://localhost/ | Vite is not running | `cd frontend && npm run dev` |
| Port 5173 in use | Previous Vite still running | `pkill -f vite`, restart |
| Module not found | Missing dependency | `npm install` |

Full system: `./scripts/start-dev.sh`, then `cd frontend && npm run dev` in another terminal, check `curl http://localhost/api/health` and `curl http://localhost/`; stop with `pkill -f vite` and `./scripts/stop-dev.sh`. The same sequence is in the developer quickstart (`quickstart/acme-developer-quickstart.md`, "Full system start/stop").

### Staging and production: backend (App Platform)

Backend only; the frontend ships via Cloudflare Pages (see [cloudflare-pages-deploy-workflow.md](cloudflare-pages-deploy-workflow.md)). Both backends are deployed manually.

```bash
doctl apps list                                  # find app ids
doctl apps get <app-id>
doctl apps create-deployment <app-id> [--wait]   # trigger a deploy
doctl apps list-deployments <app-id>             # real liveness signal
doctl apps get-deployment <app-id> <deployment-id>
doctl apps logs <app-id> backend [--type deploy|run|build] [--deployment <id>] [--tail N] [--follow]
```

Staging app id `606b6d93-5c8e-2857-a09b-05a0ff54b9d0`, production `53769b69-0720-409e-277c-190c04ab0077` (from `release-workflow.md`). Always staging, verify, then production, and tag every production deploy (`./scripts/release/tag-release.sh`). Check `git diff --name-only <live-sha>..main -- backend/migrations/versions/` first. Never read-edit-write the app spec with `doctl apps spec get` then `doctl apps update` (per the auto-memory gotcha it drops the VPC and secrets); change resources in the dashboard.

### Staging and production: droplets

Each environment has an auth droplet (`auth/stg`, `auth/prod`: tailscale, vault, nginx-auth, keycloak, init, alloy) and a workers droplet (`workers/stg`, `workers/prod`: init, redis, celery-worker, celery-beat, celery-exporter). The checkout is `/root/acme-app` (path not re-verified here).

```bash
ssh root@workers-staging-1
cd /root/acme-app/workers/stg
docker compose ps
docker compose logs --tail=100 celery-worker
docker compose exec celery-worker celery -A app.celery_app inspect active
./deploy.sh
```

- `workers/{stg,prod}/deploy.sh` fetches and `git merge --ff-only origin/main` itself, and aborts on a non-fast-forward. Confirm with `git log --oneline -1`. `SKIP_PULL=1 ./deploy.sh` deploys the checkout as-is. `auth/{stg,prod}/deploy.sh` does not pull (no git commands in it as of 2026-11-09), so `git pull origin main` first.
- The workers droplet is a separate deploy target for Celery code; a backend-only deploy does not update it.
- **Never `docker compose down` on a droplet**: tailscale is in that compose file and your SSH session dies.
- Never edit code on a droplet: localhost, PR, merge, then pull.

---

## Database Operations

### Migrations

- **Dev**: the `init` container runs `alembic upgrade head` on start (`docker compose -f workers/dev/docker-compose.yml up -d --force-recreate init` re-runs it). Manual run, using the form that avoids the Alembic trap:
  ```bash
  docker exec acme-fastapi sh -lc 'ALEMBIC_DATABASE_URL="$DATABASE_URL" alembic upgrade head'
  ```
  `backend/migrations/env.py` prefers `ALEMBIC_DATABASE_URL` (dev Supabase over 6543) over `DATABASE_URL`, so a plain `alembic upgrade head` can migrate the wrong DB. Never use port 6543 for DDL; use 5432.
- **Revisions are hand-written**: `alembic revision -m "description"`. Autogenerate is disabled on purpose (GH #1143, see the header of `backend/migrations/env.py`).
- **Staging / production**: Alembic runs as a PRE_DEPLOY job, so the new schema is live before the new code. Check for migrations before every production deploy and keep them backward compatible (expand and contract in separate deploys). See `release-workflow.md`.
- **Marketing data** has its own Alembic env in `backend/marketing_migrations/`; do not mix them.
- **Rollback**: `alembic downgrade -1` (or a revision) with the same `ALEMBIC_DATABASE_URL` care. Downgrades can lose data: back up first and try it in dev or staging.

### Backups and pools

Supabase backup and restore are managed in the Supabase dashboard (Database, Backups); plan-specific retention and point-in-time recovery were not verified from this repo. For Vault snapshots use `vault operator raft snapshot save` inside the vault container.

`DB_PROVIDER` forces the pool: Supabase 5 + overflow 10, local 20 + 40 (`backend/app/config.py`); a `DB_POOL_SIZE` in `.env` is overwritten. Staging runs a small Supabase tier (connection limit around 60 per the auto-memory note).

### Slow queries and size

Use the Supabase dashboard (Database, Query Performance) and, in the SQL editor, `EXPLAIN ANALYZE` and `pg_size_pretty(pg_database_size('postgres'))`. Adding an index is a normal hand-written migration.

---

## Secrets Management

Vault is **per-variable only**: one path per secret at `secret/acme/{env}/.env/<NAME>`, field `value`. The bulk-object schema is retired, so older commands such as `vault kv get secret/acme/dev/database` no longer apply. There is no `vault` CLI on the host; use `docker compose -f auth/dev/docker-compose.yml exec vault vault ...` (dev), `docker exec acme-vault vault ...`, or the HTTP API at `http://localhost:8200` with `VAULT_ADDR=http://localhost:8200`. Key names must match the canonical env var name. Details and rotation procedures: `.claude/rules/operational-runbook.md` and `.documentation/security/`. After changing a secret, recreate the consumer (dev: `up -d --force-recreate`; backend: new App Platform deployment; workers: `./deploy.sh` on the droplet). Dynamic database credentials (`database/creds/...`) and the earlier `backend` AppRole name in the old text were not found in the repo and are not documented here.

---

## Scaling

- **App Platform**: change instance size and count in the DigitalOcean dashboard (see the spec warning above). Pricing and slugs change; check the dashboard.
- **Droplets**: resize in the DigitalOcean console (expect downtime).
- **Celery workers**: in dev, `docker compose -f workers/dev/docker-compose.yml up -d --scale celery-worker=3`. On a droplet, change `workers/<env>/docker-compose.yml` via PR, then `./deploy.sh`.

---

## Performance Tuning

- Celery: `celery -A app.celery_app inspect active|stats` and `redis-cli llen celery` (inside `celery-worker` / `redis`; `celery_app` is `backend/app/celery_app.py`). Dev: `docker compose -f workers/dev/docker-compose.yml exec celery-worker ...`.
- Redis memory: `redis-cli INFO memory`. `FLUSHDB` clears all cached data; use with care.
- Qdrant (dev, loopback :6333): `curl http://localhost:6333/collections` lists collections; prod uses Qdrant Cloud (`VECTOR_PROVIDER=cloud`).

---

## Rollback Procedures

- **Frontend**: Cloudflare Pages one-click rollback (dashboard, project `acme-frontend-production` or `-staging`, Deployments, Rollback). The DO frontend apps were deleted 2026-07-30, so this is the only frontend rollback. Steps: [cloudflare-pages-deploy-workflow.md](cloudflare-pages-deploy-workflow.md). A git-connected Pages project has no "Create deployment" button; production ships by deploy hook (`./scripts/deploy-prod-frontend.sh`).
- **Backend (App Platform)**: there is no `doctl apps` rollback subcommand. Roll back from the dashboard (App, Deployments, previous good deployment, rollback) or redeploy a known-good commit. The `prod-YYYY-MM-DD` git tag is the rollback target. Do not roll back across a migration without reading the migration; the old code will meet the new schema.
- **Droplets**: check out the previous commit and deploy it as-is:
  ```bash
  cd /root/acme-app && git log --oneline -10 && git checkout <good-sha>
  cd workers/stg && SKIP_PULL=1 ./deploy.sh      # workers; auth deploy.sh does not pull
  ```
  Then `git checkout main` when ready to move forward again. Without `SKIP_PULL=1` the workers script merges `origin/main` and undoes the rollback (or aborts on a detached head).
- **Database**: see Migrations above.

---

## Security Procedures

- Dev: full local access, no VPN. Staging and production droplets are reached over Tailscale with key-based SSH only; Keycloak admin is not public. Backends are manual deploys only.
- Vault audit: `vault audit enable file file_path=/vault/logs/audit.log` (run inside the vault container); read with `tail -f /vault/logs/audit.log`. Not re-verified against the live Vault.
- Keycloak events: Admin Console, Events (login and admin events); retention under Realm Settings, Events. The realm YAML is shared by all environments, so config changes there re-import everywhere (see the Keycloak operator notes).
- SSH keys: add with `doctl compute ssh-key create` and the droplet's `authorized_keys`; remove the line from `authorized_keys`. Prefer key-based access with separate production keys.

---

## Monitoring and Health Checks

| Env | Service | Endpoint |
|---|---|---|
| Dev | API | `http://localhost/api/health` (also `/api/health/deep`) |
| Dev | Vault | `http://localhost:8200/v1/sys/health` (loopback; compose healthcheck probes `127.0.0.1:8200`) |
| Dev | Keycloak | `127.0.0.1:${KEYCLOAK_PORT:-8080}` (compose healthcheck is a TCP probe on 8080) |
| Dev | Qdrant | `http://localhost:6333` (loopback) |
| Dev | Mailpit | `http://localhost:8025` |
| Staging | API | `https://stg-api.acme.example/api/health/deep` |
| Production | API | `https://api.acme.example/api/health/deep` |

Droplet services (vault, keycloak, redis, celery) are reached by SSH over the tailnet. Metrics, alerts and dashboards: [grafana-alerts-runbook.md](grafana-alerts-runbook.md) and the observability docs. The backend ships no logs to Loki.

---

## Log Management

```bash
docker compose logs -f fastapi                                # dev
docker compose logs --tail=100 --since=1h fastapi
docker compose -f auth/dev/docker-compose.yml logs -f vault keycloak
docker compose -f workers/dev/docker-compose.yml logs -f celery-worker
doctl apps logs <app-id> backend --follow                     # App Platform run logs
doctl apps logs <app-id> backend --type deploy --deployment <id>
journalctl -u docker --since="1 hour ago"                     # droplet
```

Droplet compose files cap container logs with the `json-file` driver (`workers/stg/docker-compose.yml` uses `max-size` 5m or 10m and `max-file` 2). Do not run `docker system prune -a --volumes` on a droplet or a dev machine that holds data you want.

---

## Related Documentation

- [Multi-Environment Guide](./multi-environment-guide.md)
- [CI/CD Workflow Guide](./cicd-workflow-guide.md)
- [Database Provider Switching](../database/provider-switching.md)
- [Environments and deploy operator notes](environments-and-deploy-operator-notes.md)
- [Platform subsystem operator notes](platform-subsystem-operator-notes.md)

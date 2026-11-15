---
title: Droplet Auto-Deployment via GitHub Actions
tier: guide
feature: null
domains:
- devops
- security
audience:
- all
tags:
- devops
- deployment
- configuration
- infrastructure
status: complete
last_updated: '2026-07-08'
version: 1.1.0
size_kb: 7.0
line_count: 265
complexity: medium
read_time_min: 6
load_priority: 4
chunk_strategy: null
keywords:
- admin
- best-practice
- best-practices
- configuration
- deployment
dependencies: []
related: []
supersedes: []
summary: Documentation for Droplet Auto-Deployment via GitHub Actions
owner: team
sources:
- .github/workflows/deploy-backend-staging.yml
- .github/workflows/_deploy.yml
- auth/stg/deploy.sh
- auth/prod/deploy.sh
- .claude/rules/operational-runbook.md
- .documentation/devops/environments-and-deploy-operator-notes.md
- .github/workflows/ci.yml
- auth/prod/docker-compose.yml
- auth/stg/docker-compose.yml
- workers/prod/deploy.sh
- workers/prod/docker-compose.yml
- workers/stg/deploy.sh
- workers/stg/docker-compose.yml
- workers/stg/scripts/init-workers.sh
last_verified: '2026-11-10'
purpose: 'How to deploy code to the auth and workers DigitalOcean droplets: the
  per-environment deploy.sh scripts, what each does, and the tailscale/docker
  compose down trap. There is no GitHub Actions droplet deploy.'
---

# Droplet Deployment (auth and workers)

How code reaches the DigitalOcean droplets. **There is no GitHub Actions deploy for droplets.** The
workflows in `.github/workflows/` are `ci.yml`, `_deploy.yml`, `deploy-backend-staging.yml`,
`deploy-backend-production.yml`, `deploy-frontend-production.yml`, the e2e files, `security-scan.yml`
and `marketing-allowlist-guard.yml`; none of them SSHes to a droplet. (An earlier version of this doc
described `deploy-droplets-staging.yml` / `deploy-droplets-production.yml` and a set of `*_DROPLET_*`
GitHub secrets. Those workflows were added in `a3b5543b` and disabled in `9ba75632`, and are no longer in
`.github/workflows/`.) A droplet deploy is a manual run of that environment's `deploy.sh`.

Environment table, hostnames and sizes: [environments-and-deploy-operator-notes](environments-and-deploy-operator-notes.md).
The auth droplet (Keycloak + Vault) and the workers droplet (Celery worker + beat + Redis) are separate
deploy targets from the App Platform backend: a backend-only deploy does not update the workers droplet.

## Scripts

| Droplet | Script | Compose project |
|---|---|---|
| Workers staging | `workers/stg/deploy.sh` | `workers/stg/docker-compose.yml` |
| Workers production | `workers/prod/deploy.sh` | `workers/prod/docker-compose.yml` |
| Auth staging | `auth/stg/deploy.sh` | `auth/stg/docker-compose.yml` |
| Auth production | `auth/prod/deploy.sh` | `auth/prod/docker-compose.yml` |

Each script needs a `.env` next to it holding only the bootstrap variables (the ones needed before
Vault is reachable); everything else comes from Vault via the init container. A missing bootstrap
variable aborts the script.

If services are not running after a deploy, the usual cause is a missing or incomplete `.env` next to `deploy.sh` (copy `.env.example` if present and fill the bootstrap variables); a fresh droplet also needs the repo cloned first.

## Connect

Connect over Tailscale. Tailnet names (not the DO droplet names; `auth-staging` and `workers-staging`
do not resolve on the tailnet):

```bash
tailscale up
ssh root@workers-staging-1     # also workers-production, auth-staging-1, auth-production
```

The repo checkout location differs per droplet (`/root/acme-app` or `/app`); `cd` to the
`workers/{stg,prod}` or `auth/{stg,prod}` directory inside it.

## Workers droplet (Celery worker + beat)

```bash
cd <repo-root>/workers/stg     # or workers/prod
./deploy.sh
```

`workers/{stg,prod}/deploy.sh` runs, in order:

1. **`.env` and `REQUIRED_VARS` guard**: `TAILSCALE_AUTH_KEY`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`,
   `VAULT_INTERNAL_URL`. Hard-fails if one is missing.
2. **Sync the checkout (GH #1239)**: `git fetch origin main` then `git merge --ff-only origin/main`.
   **The script pulls for you.** A non-fast-forward (someone edited code on the droplet) aborts the
   deploy. `SKIP_PULL=1 ./deploy.sh` deploys the checkout as-is. Droplets are deploy targets, never
   edit surfaces: fix on localhost, PR, merge, then deploy.
3. **Docker and Compose v2 check**: installs Docker and the `docker-compose-plugin` if absent. Compose
   v1 (`docker-compose`) throws `KeyError: 'ContainerConfig'` on recreate, so v2 is mandatory.
4. **Re-run the init container** (`docker compose up --no-deps --force-recreate init`; container
   `workers-init-staging` / `workers-init-production`) to refresh the Vault-backed secrets files, and
   aborts before touching the workers if init exits non-zero. It prints the `All N required secrets
   present` line; a drop in N means secrets went missing.
5. `docker compose up -d --build --no-deps --force-recreate celery-worker celery-beat`. Both services
   must be recreated: a task registered on the worker still fails if beat was not updated, and
   vice versa.
6. **Staging only**: the opt-in cache worker (`celery-worker-cache`, profile `cache-worker`, queue
   `property_cache`) is rebuilt only if `CACHE_WORKER_ENABLED=true` in `.env` or it is already running;
   otherwise it is left down (while it is down, `property_cache` tasks queue and never run). And
   `docker compose up -d --no-deps mailpit` ensures the staging mail sink exists. `workers/prod/deploy.sh`
   has neither step.
7. Health gate: `docker compose exec -T celery-worker celery -A app.celery_app inspect ping`
   (waits up to 60 s).

Verify after:

```bash
docker compose exec celery-worker celery -A app.celery_app inspect registered   # tasks present
docker compose logs -f celery-worker celery-beat
git log --oneline -1                                                            # the commit you meant
```

## Auth droplet (Keycloak + Vault)

```bash
cd <repo-root>/auth/stg        # or auth/prod
./deploy.sh
```

`auth/{stg,prod}/deploy.sh` validates the bootstrap variables (`TAILSCALE_AUTH_KEY`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID`), then runs `docker compose pull`,
`docker compose down`, `docker compose up -d`, and prints `docker compose ps`. **It does not
`git pull`**: pull the checkout yourself first (`git -C <repo-root> pull --ff-only origin main`).
Secrets are resolved by the init container Vault-first with a `.env` fallback; the Keycloak server
sources the init-written secrets file (#599). On a first-ever bring-up, initialize Vault
(`docker compose exec vault vault operator init`) before Keycloak can read secrets.

Keycloak image changes need a rebuild and push first: see
[keycloak-custom-image-workflow](keycloak-custom-image-workflow.md).

## Gotcha: never run `docker compose down` by hand

Both compose stacks contain a **tailscale sidecar** (`tailscale-workers-staging` /
`tailscale-workers-production`, `auth-tailscale-staging` / `auth-tailscale-production`). If you SSH'd
in over the tailnet, `docker compose down` tears that container down and drops your session mid-deploy.

- On the **workers** droplet never `down`. The shipped `deploy.sh` is scoped
  (`--no-deps --force-recreate celery-worker celery-beat`, and `--no-deps` on init) precisely to avoid
  recreating tailscale. Do the same for any manual recreate.
- The **auth** `deploy.sh` intentionally does a full `down`/`up`. Run it from a session that survives a
  tailscale bounce (the DigitalOcean web console, or SSH to the droplet's public IP) rather than over the
  tailnet.

## Related

- [environments-and-deploy-operator-notes](environments-and-deploy-operator-notes.md): environments, hostnames, droplet sizes
- `.claude/rules/operational-runbook.md` (Deploys): the workers-droplet traps in summary
- `.claude/rules/release-workflow.md`: a production deploy is not finished until it is tagged

---
title: Cicd Workflow Guide
tier: guide
feature: null
domains:
- devops
- backend
- security
audience:
- all
tags:
- devops
- deployment
- testing
- security
status: complete
last_updated: '2026-07-15'
version: 1.1.0
size_kb: 12.0
line_count: 382
complexity: low
read_time_min: 10
load_priority: 2
chunk_strategy: section
keywords:
- ai
- api
- database
- deployment
- frontend
dependencies: []
related: []
supersedes: []
summary: Documentation for cicd workflow guide covering ai, api, database
owner: team
purpose: Map of the GitHub Actions workflows that exist (CI gate, security scan,
  manual deploy and E2E buttons), how deploys are guarded, Dependabot, and how
  to run the same checks locally.
sources:
- .github/dependabot.yml
- .github/workflows/_deploy.yml
- .github/workflows/_e2e.yml
- .github/workflows/ci.yml
- .github/workflows/deploy-backend-production.yml
- .github/workflows/deploy-backend-staging.yml
- .github/workflows/deploy-frontend-production.yml
- .github/workflows/e2e-full.yml
- .github/workflows/e2e-gate.yml
- .github/workflows/marketing-allowlist-guard.yml
- .github/workflows/security-scan.yml
external_refs:
- disabled/
- codeql.yml
- db-health.yml
- validate-env.yml
- performance.yml
last_verified: '2026-11-10'
---

# CI/CD & Workflow Automation Guide

What runs in GitHub Actions for Acme, how deploys are triggered, and where the rest of the gate lives. Everything under `.github/workflows/` is listed here; check that directory before relying on any workflow not named below.

> **History.** All workflows were parked in `.github/workflows/disabled/` on 2026-04-26 when the org hit its free GitHub Actions minutes cap. The ones that matter were restored on **self-hosted runners** (not billed), and the parked eight (`codeql.yml`, `db-health.yml`, `validate-env.yml`, `performance.yml`, the two `deploy-{staging,production}.yml` and the two `deploy-droplets-{staging,production}.yml`) were removed on 2026-07-15. Git history retains them. The `disabled/` directory no longer exists. There is no scheduled database-health or load-test workflow.

## What runs

| Workflow | Trigger | Runner | Purpose |
|---|---|---|---|
| `ci.yml` (CI Pipeline) | push to `main`, PR to `main`, manual | self-hosted `test` | lint and test gate |
| `security-scan.yml` | push to `main`, PR to `main`, manual, weekly cron Monday 07:00 UTC | self-hosted `scanner` | secrets, SAST, dependency audit |
| `marketing-allowlist-guard.yml` | PR to `main` | `ubuntu-latest` | marketing PR allowlist guard |
| `deploy-backend-staging.yml`, `deploy-backend-production.yml`, `deploy-frontend-production.yml` | manual only | self-hosted `test` (via `_deploy.yml`) | deploy buttons |
| `_deploy.yml` | called by the three deploy buttons | self-hosted `test` | reusable deploy logic |
| `e2e-gate.yml`, `e2e-full.yml` | manual only | self-hosted `e2e` (via `_e2e.yml`) | Playwright E2E tiers |
| `_e2e.yml` | called by the two E2E buttons | self-hosted `e2e` | reusable E2E logic |

Workflows whose name starts with `_` are reusable (`workflow_call`) and cannot be dispatched directly.

### CI Pipeline (`ci.yml`)

Progressive and diff-scoped (#929): on a PR it does only the work the diff touches; a manual dispatch has no diff and runs everything. It is deliberately **not a required status check**: an offline self-hosted runner queues jobs instead of failing, so closing the workstation must never block a merge. It never uses `pull_request_target`.

| Job | Runs when | Description |
|---|---|---|
| `changes` | always | path-filters the diff (frontend, backend, theme, infra); fails safe to "run all" |
| `lint` | frontend, backend or infra changed | progressive lint (ruff, eslint, tsc, mypy via gimme-the-lint; only NEW violations block) plus the repo guards |
| `frontend-tests` | frontend changed | vitest (`--changed` on PRs, full otherwise) |
| `backend-tests` | backend changed | pytest matrix groups, in-job postgres and redis |
| `theme-tests` | Keycloak theme changed | theme types and appearance checks |
| `test-summary` | always | rollup; fails if any needed job failed |

Full detail: [CI test gate](ci-test-gate.md). Scanner runners: [self-hosted scanner runners](self-hosted-scanner-runners.md).

```bash
gh run list --workflow=ci.yml
```

### Security scan (`security-scan.yml`)

Two jobs: `scan` (gitleaks for secrets plus semgrep `p/security-audit` for SAST, both always run and both can fail the job) and `deps` (npm audit gate, pip-audit and osv-scanner). It replaced CodeQL, Snyk and gitleaks-action, which needed org-level licences or secrets this org does not have. Details in [CI test gate](ci-test-gate.md#security-scanners-separate-workflow).

### Deploy buttons

Deploys are **manual**: merging to `main` does not deploy the backend or production frontend. Run them from Actions ("Run workflow") or `gh workflow run <file>`.

| Button | Target | Confirmation |
|---|---|---|
| `deploy-backend-staging.yml` | DigitalOcean App Platform staging backend | none |
| `deploy-backend-production.yml` | DigitalOcean App Platform production backend | type `DEPLOY` |
| `deploy-frontend-production.yml` | Cloudflare Pages production, via the deploy hook | type `DEPLOY` |

`_deploy.yml` holds all the guardrails: it refuses to run from any branch but `main` (DigitalOcean and Cloudflare both build `main` whatever branch you pick), requires `DEPLOY` for production targets, runs only one deploy per target at a time (`cancel-in-progress: false`), uses `doctl apps create-deployment` (never `apps update --spec`), waits for the deployment to finish, then checks `/api/health/deep` reports `healthy` (ACTIVE only means the container started). Frontend production fires the `CF_PAGES_DEPLOY_HOOK_PROD` hook and checks the site responds. After a verified run it records a GitHub Deployment. Secrets it reads: `DIGITALOCEAN_ACCESS_TOKEN`, `CF_PAGES_DEPLOY_HOOK_PROD`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`.

The staging frontend (Cloudflare Pages project `acme-frontend-staging`) deploys automatically on merge to `main`. Production frontend auto-deploy is off; the alternative to the button is `./scripts/deploy-prod-frontend.sh`. Rollback is Cloudflare dashboard, project, Deployments, Rollback. See [Cloudflare Pages deploy workflow](cloudflare-pages-deploy-workflow.md).

Always deploy staging, verify, then production, and tag every production deploy. See `.claude/rules/release-workflow.md` and [environments and deploy](environments-and-deploy-operator-notes.md).

### E2E buttons

`e2e-gate.yml` (fast tier, chromium) and `e2e-full.yml` (all browsers plus live vendors) are manual `workflow_dispatch` only and need the dev stack up on the runner host.

## Secrets

Application secrets live in Vault, one path per variable: `secret/acme/{env}/.env/{VAR_NAME}` (value in `value`). GitHub Actions secrets used by the current workflows are the four deploy secrets above. Scanners need none: the old `SNYK_TOKEN` and `GITLEAKS_LICENSE` references were removed.

## Dependency management

`.github/dependabot.yml` runs weekly on Mondays for four ecosystems:

| Ecosystem | Directory | PR limit |
|---|---|---|
| pip | `/backend` | 5 |
| npm | `/frontend` | 5 |
| github-actions | `/` | 3 |
| docker | `/backend` | default |

Updates are grouped (pip minor, npm react-ecosystem, testing, linting and minor, actions). Dependabot PRs run against live CI.

## Running checks locally

The pre-push hook is the real gate (install with `bash .githooks/install.sh`); `scripts/ci/guards.sh` is the single guard script both the hook and CI call.

```bash
./.claude/scripts/run-checks.sh --fix                 # lint changed files
npx gimme-the-lint check --all --stage push           # without --stage push mypy/tsc never run
./scripts/contract-check.sh                           # API contract engine
cd frontend && npm test
```

Backend pytest needs local environment alignment (see the operational runbook; never run it inside `acme-fastapi`).

## Troubleshooting

- **CI jobs sit queued**: the self-hosted runner is offline. Start it (`acme-app/runners`, `./runners.sh start-test`); CI is not a required check, so merges are not blocked.
- **A deploy button fails immediately**: it was started from a non-`main` branch, or the production confirmation box did not say `DEPLOY`.
- **Deploy "succeeded" but the API is unhealthy**: read the health step output of `_deploy.yml` and `curl https://api.acme.example/api/health/deep` (staging: `https://stg-api.acme.example/api/health/deep`).
- **Lint fails on PR**: run the same command locally (above); fix the NEW violations only, the baseline holds the rest.

## Related

- [CI test gate](ci-test-gate.md)
- [Self-hosted scanner runners](self-hosted-scanner-runners.md)
- [Cloudflare Pages deploy workflow](cloudflare-pages-deploy-workflow.md)
- [Environments and deploy notes](environments-and-deploy-operator-notes.md)
- [Testing standards](../standards/testing/testing-strategy.md)
- [Security strategy](../security/strategy-overview.md)

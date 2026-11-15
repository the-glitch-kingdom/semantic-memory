---
title: Contributing
tier: guide
feature: null
domains:
- standards
- backend
- database
- devops
- frontend
- security
audience:
- all
tags:
- standards
- guide
- testing
status: complete
last_updated: '2026-01-11'
version: 1.0.0
size_kb: 10.0
line_count: 489
complexity: low
read_time_min: 10
load_priority: 2
chunk_strategy: section
keywords:
- ai
- database
- deployment
- frontend
- pytest
dependencies: []
related:
- standards/devops/ci-cd.md
- standards/documentation-routing-policy.md
- devops/cicd-workflow-guide.md
supersedes: []
summary: Contributing guide checked against .githooks, commitlint.config.js, the
  PR template and the workflows on 2026-11-10.
owner: team
purpose: 'Contributor workflow for Acme: setup, branch and PR flow,
  commit format, style, testing, deployment pointers.'
sources:
- .claude/rules/git-workflow.md
- .claude/rules/pre-commit-workflow.md
- .claude/rules/release-workflow.md
- .claude/scripts/pre-push-check.sh
- .githooks/install.sh
- .githooks/pre-commit
- .githooks/pre-push
- .github/PULL_REQUEST_TEMPLATE.md
- .github/workflows/_deploy.yml
- .github/workflows/deploy-backend-production.yml
- .pre-commit-config.yaml
- backend/Dockerfile
- backend/pytest.ini
- backend/requirements-dev.txt
- commitlint.config.js
- frontend/package.json
- frontend/vitest.config.js
- pyproject.toml
external_refs:
- feature/
- fix/
- refactor/
- test/
- chore/
last_verified: '2026-11-10'
---

# Contributing to Acme

How a change gets from a branch to `main`. Rewritten against the repo on 2026-11-10; the earlier text described a Railway deploy, the `pre-commit` framework as the installed hook mechanism, squash merges and 100-character style rules that this repo does not use. The working rules are in `.claude/rules/` (`git-workflow.md`, `pre-commit-workflow.md`, `release-workflow.md`); this page is the human-readable summary.

## Getting started

Full setup is in [`quickstart/setup.md`](../../quickstart/setup.md). The short version:

- **Prerequisites**: Python 3.12 (the `backend/Dockerfile` pin), Node 22 (the CI runner and Keycloak theme build both use it), Docker, Git, GitHub CLI (`gh auth login`). No Railway CLI: backends deploy to DigitalOcean App Platform, the frontend to Cloudflare Pages.
- **Hooks**: `bash .githooks/install.sh` sets `core.hooksPath` to `.githooks/`. Those hooks are the supported gate (`pre-commit`: progressive lint of changed files, project-map regeneration, Keycloak image secret scan; `pre-push`: ruff on `backend/`, frontend build, repo guards, the Keycloak image secret scan, and (when models, schemas or routers changed) the contract check; frontend ESLint and the test suites are off by default there). `.pre-commit-config.yaml` (the `pre-commit` framework) also exists but is not what the installer sets up.
- **Backend**: `python -m venv .venv && source .venv/bin/activate && pip install -r backend/requirements.txt -r backend/requirements-dev.txt`. Always the repo `.venv`, never system Python.
- **Frontend**: `cd frontend && npm ci`, then `npm run dev` (nginx on `http://localhost` proxies to Vite).
- **Dev stack**: `./scripts/start-dev.sh --fast`.

## Workflow

1. **Sync `main`, then branch.** Never commit to `main`.
   ```bash
   git checkout main && git fetch origin main && git merge --ff-only origin/main
   git checkout -b <type>/<short-description>
   ```
   Branch types follow the commit types: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.
2. **Make the change.** Minimal scope: only what was asked. Add tests with the change.
3. **Commit.** The `pre-commit` hook lints only changed files and blocks on new violations. If it fails, run `./.claude/scripts/run-checks.sh --fix`, re-stage and commit again. Never use `--no-verify` unless explicitly authorised.
4. **Push the branch and open a PR with `gh`** (`gh pr create --base main`). The template is `.github/PULL_REQUEST_TEMPLATE.md`: description, type, related issues, testing, security checklist, deployment checklist.
5. **CI**: `ci.yml` (lint, vitest, pytest, theme) and `security-scan.yml` run on the PR. CI runs on self-hosted runners and is not a required check, so confirm it ran. See [CI/CD standards](../devops/ci-cd.md).
6. **Merge only with permission.** A PR is merged with `gh pr merge <number> --merge --delete-branch` after the user says so; "open a PR" is not permission to merge. History on `main` shows merge commits (`Merge pull request #...`), not squashes. After a merge, sync local `main` again.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`, header at most 100 characters, imperative, sentence-case subject (commitlint `subject-case`), no period. Types in `commitlint.config.js`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`, `db`, `config`.

- Describe what changed and why; list files changed and their purpose in the body. Reference issues (`Closes #123`).
- **No AI attribution** in commit messages.
- `commitlint` runs only through the `pre-commit` framework's `commit-msg` stage, which the `.githooks/` installer does not set up, so nothing blocks a non-conforming message locally. Follow the format anyway.

## Code style

Style is enforced by the linters, not by this page; the baseline is progressive (only new violations block). See [progressive linting](../linting/progressive-linting.md) and [ESLint strategy](../linting/eslint-strategy.md).

- **Python**: Ruff (lint and format) and mypy; no line-length override is configured, so Ruff's default applies. Type hints are required on `backend/app` functions (`disallow_untyped_defs`).
- **JavaScript/TypeScript**: ESLint (`frontend/eslint.config.js`) and `tsc --noEmit`. There is no Prettier in this repo.
- **Naming**: `snake_case` (Python), `camelCase` (JS/TS), `PascalCase` classes and components, `UPPER_SNAKE_CASE` constants.
- **Comments** explain why, not what. TODOs carry a ticket number.
- **Generated files** (anything with a "never hand-edit" banner, `openapi.json`, `api-types.ts`, `shared/*` outputs): change the source and regenerate. See `.claude/rules/single-source-generation.md`.

## Testing

- **Backend**: tests live in `backend/tests/` (`unit/`, `integration/`, `security/`). With the repo venv active: `cd backend && python -m pytest tests -v`. Markers are in `backend/pytest.ini`.
- **Frontend**: tests live under `frontend/tests/` (vitest collects `tests/**` only, so a co-located `*.test.ts` under `src/` is not run). `cd frontend && npm run test:run`; E2E is `npm run test:e2e` (`frontend/tests/e2e`).
- Detail and commands: [CI/CD standards](../devops/ci-cd.md#testing-standards) and [frontend testing](../frontend/testing.md).

## Deployment

Merging to `main` deploys only the **staging frontend** (Cloudflare Pages). Everything else is a manual button: `deploy-backend-staging.yml`, `deploy-backend-production.yml` (type `DEPLOY`), `deploy-frontend-production.yml` (type `DEPLOY`). Always staging, verify, then production. Check for new Alembic migrations before a production deploy (they run `PRE_DEPLOY` against the old code), and **tag every production deploy** with `./scripts/release/tag-release.sh`; the tag is the rollback target.

Rollback: frontend is a Cloudflare Pages one-click rollback. The backend deploy buttons build `main` only (the workflow refuses any other ref), so a previous tag cannot be deployed from the button: revert the bad change on `main` through a PR, then run the production button again. The prod tag shows what to revert to (`git diff <previous-tag>..<tag>`). Full procedure: `.claude/rules/release-workflow.md`, [CI/CD workflow guide](../../devops/cicd-workflow-guide.md), [environments and deploy](../../devops/environments-and-deploy-operator-notes.md).

## Documentation

Docs go in `.documentation/` through `hewtd integrate`; never a `/docs` folder or a stray `.md`. Which repo a doc belongs in: [documentation routing policy](../documentation-routing-policy.md). Placement rules: `.claude/rules/documentation-placement.md`.

## Getting help

- Search the docs: `/docs search <term>` or the `semantic-memory-docs` MCP index; start at `.documentation/INDEX.md`.
- Bugs and ideas: open a GitHub issue with `gh issue create`.

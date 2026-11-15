---
title: >-
  The cookie-custody Playwright merge gate self-skipped every run for months,
  because its liveness probe used the wrong URL
tier: fact
domains:
  - knowledge-base
  - testing
  - frontend
status: active
last_updated: '2026-07-09'
id: cookie-custody-e2e-gate-self-skipped-on-wrong-probe-path
confidence: high
last_verified: '2026-11-10'
provenance:
  - 'PR for #768 Phase 6 — frontend/tests/e2e/auth/cookie-custody.spec.ts'
  - 'curl POST /api/auth/session/refresh -> 404; /api/v1/... -> 403'
tags:
  - playwright
  - testing
  - false-negative
  - cookie-custody
verify_command: >-
  cd frontend && VITE_OFFLINE_ACCESS_ENABLED=true npx playwright test
  tests/e2e/auth/cookie-custody.spec.ts --reporter=line
  # must report tests PASSED, not "skipped". Any "N skipped" with the flag on is the bug.
purpose: Why did the cookie-custody Playwright spec report skipped tests as a
  pass, and what makes a runtime skip probe safe?
sources:
  - frontend/tests/e2e/auth/cookie-custody.spec.ts
  - frontend/tests/e2e/auth/auth.setup.ts
  - frontend/playwright.config.js
  - frontend/tests/e2e/gate.manifest
  - .github/workflows/e2e-gate.yml
  - .github/workflows/e2e-full.yml
  - backend/app/auth/session_router.py
  - .documentation/troubleshooting/frontend-auth-api-client.md
external_refs:
  - .github/workflows/e2e.yml
  - disabled/
  - ../../playwright/.auth/user.json
  - ../../../playwright/.auth/user.json
---

# The cookie-custody merge gate self-skipped every run

## Claim

`frontend/tests/e2e/auth/cookie-custody.spec.ts` guarded the #534 long-idle session-recovery flow.
Its runtime skip probe was:

```ts
const res = await request.post('/api/auth/session/refresh', { failOnStatusCode: false });
// 404/501 = endpoint not deployed (flag off)
return res.status() !== 404 && res.status() !== 501;
```

The real path is **`/api/v1/auth/session/refresh`**. The probed path is a hard 404 in every
environment:

```
POST /api/auth/session/refresh      -> 404
POST /api/v1/auth/session/refresh   -> 403   (CSRF fail-closed guard; endpoint IS live)
```

So the probe always concluded "flag off" and every test in the file called `test.skip()`. Every test in the
file (four at the time, eight as of 2026-11-09) ran **zero** times. The operational runbook cited this file as the "Playwright merge-gate"
for the offline-access rollout.

## Why nobody noticed

A skipped Playwright test prints as a pass at the suite level (`4 skipped, 1 passed`) and exits `0`.
Combined with the old `.github/workflows/e2e.yml` parked in `.github/workflows/disabled/` until the manual warm-stack buttons replaced it (#1028; this spec runs only in `e2e-full.yml`, never in `e2e-gate.yml`) — and, even when enabled, carrying
`continue-on-error: true` at both the job and step level, and triggering only on push to `main` rather
than on pull requests — nothing in CI could ever have surfaced it.

## Two bugs it was hiding

Fixing the probe made the tests run for the first time, which immediately exposed:

1. **A wrong `authFile` path.** The spec resolved `../../playwright/.auth/user.json`
   (→ `tests/playwright/...`), but `auth.setup.ts` and `playwright.config.js` write and read
   `../../../playwright/.auth/user.json` (→ `frontend/playwright/...`). Every cookies-only test threw
   `ENOENT`.
2. **Parallel-worker session interference.** See [[playwright-tests-sharing-one-session-cookie-must-run-serial]].

## Lesson

A runtime skip guard is a silent kill switch. It must be **falsifiable**: assert that the
feature-detection probe itself returns what you expect, or split it so a misconfiguration *fails*
rather than skips. Separate "is the backend endpoint deployed" from "is the frontend flag compiled
in" — they are independent, and only the second should ever cause a skip.

Practical rule: if a spec can skip, print the reason, and check the skip count in review. `N skipped`
is not `N passed`.

## Related

- [[keycloak-offline-login-removes-the-sso-session]]
- [[playwright-tests-sharing-one-session-cookie-must-run-serial]]
- `.documentation/troubleshooting/frontend-auth-api-client.md` §5

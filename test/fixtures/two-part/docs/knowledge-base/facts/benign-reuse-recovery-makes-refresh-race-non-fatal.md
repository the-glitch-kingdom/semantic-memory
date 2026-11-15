---
title: >-
  Recover from a benign concurrent token rotation by re-reading and retrying
  rather than revoking the session, to make the single-use refresh race non-fatal
tier: fact
domains:
  - knowledge-base
  - security
status: active
last_updated: '2026-06-08'
id: benign-reuse-recovery-makes-refresh-race-non-fatal
confidence: high
last_verified: '2026-11-10'
provenance:
  - >-
    .documentation/knowledge-base/incidents/2026-06-08-issue-534-backend-session-refresh-race/
tags: [keycloak, refresh-token, concurrency, bff]
purpose: Documents the pattern of recovering from a benign concurrent
  refresh-token rotation (re-read, retry if the stored token changed, revoke
  only if unchanged) instead of relaxing single-use refresh tokens.
symptoms:
  - OFFLINE_TOKEN_REUSE_EXCEEDED on /session/refresh when two requests refresh
    at once
sources:
  - backend/app/auth/session_router.py
  - backend/tests/security/test_session_router_refresh_race.py
  - keycloak/realms/acme.yaml
  - .documentation/knowledge-base/incidents/2026-06-08-issue-534-backend-session-refresh-race
---

# Benign-reuse recovery makes the single-use refresh race non-fatal

## Claim

With single-use refresh tokens (`refreshTokenMaxReuse: 0`), a concurrent refresh
race is unavoidable when serialization can fail. Instead of trying to prevent every
race, make it **non-fatal on the server**: when an exchange fails with
reuse-exceeded, re-read the stored token; if it CHANGED since you read it, a sibling
request already rotated and persisted a fresh one (a benign race) — retry the
exchange with the new token and return success. Only revoke when the token is
unchanged (genuinely dead), the retry also fails, or the error is not reuse-related.

## Why it works

The only writer of the stored token is the post-exchange persist, so an unchanged
ciphertext on re-read reliably means "no sibling won" and a changed one means "a
sibling won." This distinguishes a benign concurrent rotation from a truly expired
or revoked token, and it is independent of worker count or whether the DB lock
actually serialized the callers. Keep reuse-detection ON as the tripwire; recover
from the benign case rather than relaxing the setting. See
`backend/app/auth/session_router.py` and the regression test
`backend/tests/security/test_session_router_refresh_race.py`.

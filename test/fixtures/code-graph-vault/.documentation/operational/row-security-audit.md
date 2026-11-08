---
title: Row security audit
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Row security audit

Every tenant table must be covered by a row level security policy. The audit script lists tables that have none and exits non-zero so the pipeline stops.

Run `backend/scripts/check_rls_coverage.py` locally before adding a table, and see `scripts/ci/guards.sh` for where the pipeline calls it.

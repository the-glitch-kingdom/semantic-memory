---
title: Session cleanup
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Session cleanup

Idle login sessions stay in the table until they are reaped. The reaper expires sessions that were silent for twelve hours and writes a count to the job log. Run it manually when the session table grows unexpectedly.

The step lives in `backend/scripts/reap_sessions.py`.

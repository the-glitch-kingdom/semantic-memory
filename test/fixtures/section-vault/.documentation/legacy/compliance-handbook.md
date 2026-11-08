---
title: Compliance handbook
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Compliance handbook

Handbook notes kept by the old team.

## Legal hold on audit logs

A legal hold freezes the audit log partitions named in the request. Counsel sends the case number, and you run `holdctl place --case <number> --from <date>`.
Held partitions skip compaction and expiry until counsel releases the case in writing; the hold register must show the release before you run `holdctl lift`.

## Contacts

Ask the team channel before changing anything here.

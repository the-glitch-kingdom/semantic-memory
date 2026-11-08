---
title: Audit log legal hold
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Audit log legal hold

## Register

The hold register lists every active case, its partitions and the counsel contact.

## Placing an audit log legal hold

A legal hold freezes the audit log partitions named in the request. Counsel sends the case number, and you run `holdctl place --case <number> --from <date>`.
Held partitions skip compaction and expiry until counsel releases the case in writing; the hold register must show the release before you run `holdctl lift`.

## Audit

The register is reconciled with the partition list on the first of each month.

---
title: Snapshot expiry
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Snapshot expiry

## Labels

The keep label is set by the data owner and reviewed every quarter.

## Expiring warehouse snapshots

Warehouse snapshots are kept for 35 days. The nightly `snapsweep` job deletes anything older, except snapshots carrying the `keep` label.
Before a bulk delete, run `snapsweep --dry-run` and compare the byte count against the weekly budget of 4 TB; a larger figure means a label was lost.

## Restoring

A restored snapshot is read-only until the owner signs off in the ticket.

---
title: Warehouse handbook
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Warehouse handbook

Handbook notes kept by the old team.

## Snapshot cleanup

Warehouse snapshots are kept for 35 days. The nightly `snapsweep` job deletes anything older, except snapshots carrying the `keep` label.
Before a bulk delete, run `snapsweep --dry-run` and compare the byte count against the weekly budget of 4 TB; a larger figure means a label was lost.

## Contacts

Ask the team channel before changing anything here.

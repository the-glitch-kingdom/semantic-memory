---
title: Backup pruning
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Backup pruning

Nightly snapshots pile up on the storage volume. Each night the pruning step deletes snapshots older than the retention window and keeps one per week. Run it by hand after a restore test to reclaim space.

The step lives in `backend/jobs/prune_backups.py`.

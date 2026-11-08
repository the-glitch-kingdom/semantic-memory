---
title: Metrics compaction
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Metrics compaction

Raw metrics are kept at ten second resolution for two days only. The compaction step rolls older points into five minute buckets and removes the raw rows. Check the bucket count afterwards to confirm nothing was skipped.

The step lives in `backend/scripts/compact_metrics_old.py`.

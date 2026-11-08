---
title: Flag sync
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Flag sync

Feature flags live in the config service and are mirrored to each region. The sync step copies the current flag set to every region and reports flags that differ. Run it after changing a flag when a region still shows the old behavior.

The step lives in `backend/scripts/sync_feature_flags.py`.

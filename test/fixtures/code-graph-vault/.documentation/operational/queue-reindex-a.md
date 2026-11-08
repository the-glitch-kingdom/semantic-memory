---
title: Queue reindex
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Queue reindex

When search results lag behind the database, the index queue has fallen behind. The reindex step replays pending changes in order and then clears the backlog marker. Pause the writers first so the replay can finish.

The step lives in `backend/scripts/reindex_queue_old.py`.

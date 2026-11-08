---
title: Thumbnail rebuild
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Thumbnail rebuild

Image previews go blank when the thumbnail cache is cleared. The regeneration step rebuilds missing previews from the originals in batches of two hundred. Watch the worker CPU, since large originals take a while.

The step lives in `backend/jobs/regen_thumbnails.py`.

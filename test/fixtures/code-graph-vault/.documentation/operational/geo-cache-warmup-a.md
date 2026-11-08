---
title: Geo cache warmup
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Geo cache warmup

After a deploy the location lookup cache starts cold and the first requests are slow. The warm-up step preloads the hundred busiest regions into the cache before traffic returns. Skip it for a canary that carries no traffic.

The step lives in `backend/scripts/warm_geo_cache_old.py`.

---
title: Skerry cache stampede decision
type: decision
---
# Skerry cache stampede decision

When the Skerry edge cache expired a hot key, hundreds of workers recomputed it at once and knocked over the origin. We decided to add request coalescing: the first worker takes a lease, the rest wait for its result. We rejected longer TTLs because stale prices reached customers.

The lease lasts 4 seconds. A worker that loses the lease serves the previous value for up to 30 seconds.

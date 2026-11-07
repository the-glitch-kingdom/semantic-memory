---
title: Offline Sync
purpose: How a vessel that lost its uplink for days catches up when connectivity returns.
tags: [operational, ingest]
domain: operational
---

# Offline Sync

While the link is down the gateway spools readings to local disk in 64 MB segments. When the link
is back it replays them oldest first, throttled to 200 messages per second so live traffic is not
starved. Segments are deleted once the broker acknowledges them.

---
title: Clock drift reorders positions
tags: [gotcha, ingest]
domain: knowledge-base
type: fact
symptoms:
  - vessel track zigzags backwards
  - positions arrive out of order
verify_command: chronyc tracking
---

# Clock drift reorders positions

Gateways without GPS time sync drift by up to 90 seconds a day. Readings stamped by the drifting
clock sort before older ones, so the trail doubles back. The server rejects any ts_utc more than 5
minutes in the future.

## Instead

Enable chrony on the gateway so its clock follows the GPS pulse.

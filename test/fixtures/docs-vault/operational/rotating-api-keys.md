---
title: Rotating API Keys
tags: [operational, runbook, security]
domain: operational
---

# Rotating API Keys

Ingest and dashboard keys are replaced every 90 days.

1. Run `tidewatch keys rotate --scope ingest`.
2. Roll the new key out to the gateways.
3. The previous key keeps working for a grace period of 24 hours, then stops.

Who may do this is described in [[access-control]]. The grace length is set in the
[config reference](../reference/config-reference.md).

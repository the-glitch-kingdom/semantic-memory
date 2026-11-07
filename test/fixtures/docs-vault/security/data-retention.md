---
title: Data Retention Policy
tags: [security, compliance]
domain: security
---

# Data Retention Policy

- Passenger manifest data is deleted after 30 days.
- Vessel position history is kept for 7 years to satisfy the maritime regulator.
- Engine and fuel readings follow the [[storage-tiers]] schedule.

## Legal hold

When counsel places a legal hold, an administrator tags the affected vessels and the nightly deletion
job skips them until the hold is lifted. Record the hold reference in the ticket.

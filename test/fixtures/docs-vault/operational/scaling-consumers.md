---
title: Scaling Consumers
tags: [operational, runbook, ingest]
domain: operational
---

# Scaling Consumers

Add pier-workers when the backlog on the Harbor Queue exceeds 10,000 messages for more than five
minutes. The topic has 48 partitions, so the ceiling is 24 workers; beyond that add partitions first.
Background on the flow is in the [ingest pipeline](../architecture/ingest-pipeline.md).

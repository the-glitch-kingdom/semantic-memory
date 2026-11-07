---
title: Uplink Cost Controls
summary: Cap satellite data spend per vessel and choose which readings are sent over the expensive link.
tags: [operational, cost]
domain: operational
---

# Uplink Cost Controls

Set `sat_budget_mb` per vessel. Once the monthly budget is spent only critical readings are sent;
everything else waits for port wifi and is delivered in bulk on arrival.

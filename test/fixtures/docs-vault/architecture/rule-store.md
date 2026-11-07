---
title: Rule Store
purpose: Where alert rules are stored and how they are edited and versioned.
tags: [architecture, alerting]
domain: architecture
---

# Rule Store

Rules live in a small relational table. Every edit creates a new revision and the previous one can be
restored from the dashboard.

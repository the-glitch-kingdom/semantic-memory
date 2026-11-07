---
title: Alerting Engine
tags: [architecture, alerting]
domain: architecture
---

# Alerting Engine

The engine, named Beacon, evaluates every alert rule against fresh readings every 30 seconds.
Readings come from the [[ingest-pipeline]] and long-range rules read history from
[storage](storage-tiers.md).

## Severities

Rules carry one of three severities: advisory, warning or critical. Advisory and warning show up on
the dashboard. A critical alert also calls the paging webhook so the on-call engineer is woken.

## Cooldown

To prevent alert fatigue a rule that already fired stays quiet for a cooldown of 15 minutes before it
may fire again, even if the condition holds throughout.

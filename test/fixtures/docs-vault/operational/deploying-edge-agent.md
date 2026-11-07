---
title: Deploying the Edge Agent
tags: [operational, runbook, deployment]
domain: operational
---

# Deploying the Edge Agent

The edge agent runs on the gateway aboard each vessel.

## Canary

Every release goes to a canary of 5% of vessels for 48 hours. Watch the error rate with
`tidewatch fleet status` (see the [CLI reference](../reference/cli-reference.md)).

## Rollback

If the canary misbehaves run `tidewatch fleet rollback` to return every gateway to the previous
release.

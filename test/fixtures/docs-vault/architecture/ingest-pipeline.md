---
title: Ingest Pipeline
tags: [architecture, ingest, telemetry]
domain: architecture
---

# Ingest Pipeline

Vessel gateways publish telemetry over MQTT to the Harbor Queue. A consumer group called
`pier-workers` drains the queue, validates each payload against the
[message schema](../reference/message-schema.md#fields) and writes accepted readings to the
[[storage-tiers]].

## Batching

Workers flush a batch when it reaches 500 messages or when 2 seconds have passed, whichever comes
first. Smaller batches lower latency; larger ones cut write amplification.

## Failure handling

A payload that fails validation or a write is retried. After 5 retries it is moved to the
dead-letter topic `harbor.dlq`, where an engineer can inspect it and replay it later with
`tidewatch replay --from`.

## Scaling

When consumers fall behind, follow [scaling consumers](../operational/scaling-consumers.md).

---
title: System Overview
tags: [architecture]
domain: architecture
---

# System Overview

Tidewatch follows a reading from sensor to screen in five stages.

## Collection

A gateway on each vessel buffers sensor readings and publishes them over MQTT.

## Processing

Workers validate every reading and write the accepted ones out.

## Alerting

The Beacon engine checks alert rules continuously and pages the on-call engineer for critical ones.

## Storage

Data ages through hot, warm and cold tiers before it is deleted.

## Access

Staff sign in with their company login and see only what their role allows.

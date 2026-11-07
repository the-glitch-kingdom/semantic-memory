---
title: Message Schema
tags: [reference, ingest, telemetry]
domain: reference
---

# Message Schema

## Fields

Each telemetry message is JSON with these fields: vessel_id, ts_utc, lat, lon, engine_rpm and
fuel_lph. The header `schema=3` selects this layout. A payload may be at most 8 KB.

The messages are consumed by the [[ingest-pipeline]].

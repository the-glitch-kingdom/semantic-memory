---
title: MQTT retained flag replays
tags: [gotcha, ingest]
domain: knowledge-base
type: fact
symptoms:
  - totals double after a gateway reconnects
verify_command: grep -r "retain" gateway.conf
---

# MQTT retained flag replays

A publish with the retain flag set is delivered again to every new subscription, including the
subscription a gateway re-creates when it reconnects. The last reading is therefore counted twice.

## Instead

Never set retain on telemetry topics.

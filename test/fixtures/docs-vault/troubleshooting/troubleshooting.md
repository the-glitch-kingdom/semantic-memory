---
title: Troubleshooting
tags: [troubleshooting]
domain: troubleshooting
---

# Troubleshooting

## Lag keeps growing

Check the worker count against [[scaling-consumers]].

## Ingest answers HTTP 401 after a key change

The gateway still sends the old key after the overlap ended. Push the new key, see
[rotating api keys](../operational/rotating-api-keys.md).

## Tracks look wrong

See the knowledge-base fact on [clock drift](../knowledge-base/facts/clock-drift-reorders-positions.md).

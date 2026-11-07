---
title: Rate Limits
tags: [reference]
domain: reference
---

# Rate Limits

The ingest API allows 600 requests per minute per key. Excess requests get HTTP 429 with a
Retry-After header.

---
title: Configuration Reference
tags: [reference, config]
domain: reference
---

# Configuration Reference

| Variable | Default | Meaning |
|---|---|---|
| TIDEWATCH_BATCH_SIZE | 500 | messages per flush |
| TIDEWATCH_FLUSH_MS | 2000 | longest wait before a flush |
| TIDEWATCH_DLQ_RETRIES | 5 | attempts before dead-lettering |
| TIDEWATCH_GRACE_HOURS | 24 | overlap when a key is replaced |

See the [[ingest-pipeline]] for how batching works.

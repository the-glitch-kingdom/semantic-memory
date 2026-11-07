---
title: Cache warm up
type: note
tags: [code]
domain: code
---

# Cache warm up

After a failover, prime the cache from the shell.

```bash
warmctl prime --region eu --shards 8
```

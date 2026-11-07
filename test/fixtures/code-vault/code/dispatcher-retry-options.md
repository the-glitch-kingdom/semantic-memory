---
title: Dispatcher retry options
type: note
tags: [code]
domain: code
---

# Dispatcher retry options

Retry behaviour of the dispatcher is tuned with one setting.

| Variable | Default | Meaning |
|---|---|---|
| KESTREL_RETRY_BUDGET | 7 | Attempts before a job is parked |

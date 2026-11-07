---
title: Webhook Failure Handling
type: note
tags: [ops]
domain: ops
---

# Webhook Failure Handling

A failed webhook delivery is attempted again 3 times with growing pauses. After that it lands in the dead-letter list.

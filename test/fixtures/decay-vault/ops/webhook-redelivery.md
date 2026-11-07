---
title: Webhook Redelivery
type: note
tags: [ops]
domain: ops
last_verified: {{ago:5}}
---

# Webhook Redelivery

A failed webhook delivery is attempted again 6 times with growing pauses. After that it lands in the dead-letter list.

---
title: Cert renewal
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Cert renewal

TLS certificates are renewed thirty days before they expire. The renewal step requests a new certificate, swaps it into the load balancer and keeps the previous one for a day. Confirm the new expiry date in the browser after the swap.

The step lives in `backend/scripts/renew_certs.py`.

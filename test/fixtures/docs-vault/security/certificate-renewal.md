---
title: Certificate Renewal
purpose: Renew gateway TLS certificates before they lapse and what breaks when one does.
tags: [security, runbook]
domain: security
---

# Certificate Renewal

Certificates are valid for 13 months. Run `tidewatch certs renew` 30 days ahead. A gateway whose
certificate expired is refused by the broker and stays silent until the new identity file is copied
to it.

---
title: Audit export
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Audit export

Auditors ask for the activity trail once a quarter. The export step writes every audit event for the period into a signed archive and records its checksum. Send the archive over the secure share, never by mail.

The step lives in `backend/scripts/export_audit_log.py`.

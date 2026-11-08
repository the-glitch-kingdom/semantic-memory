---
title: Tenant offboarding
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Tenant offboarding

When a customer leaves, their data must be removed within thirty days. The offboarding step disables logins, exports a final copy for the customer and deletes the tenant rows. Keep the deletion receipt for the compliance file.

The step lives in `backend/scripts/offboard_tenant_old.py`.

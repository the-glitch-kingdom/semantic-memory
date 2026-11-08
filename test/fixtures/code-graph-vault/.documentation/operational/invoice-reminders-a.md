---
title: Invoice reminders
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Invoice reminders

Customers with unpaid invoices get a reminder email three days before the due date. The reminder job skips accounts on a payment plan and logs each message it sends. Rerun it for one account after fixing a wrong billing address.

The step lives in `backend/scripts/send_invoice_reminders.py`.

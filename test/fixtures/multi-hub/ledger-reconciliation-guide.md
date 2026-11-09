# Ledger Reconciliation Guide

How to investigate a mismatch between the nightly ledger totals and the sum of invoices and payments.

## Finding the difference

Start from the per-account difference list that the nightly job attaches to the ticket. Sort by absolute value; mismatches almost always concentrate in a handful of accounts. Check each for a payment captured after its invoice was voided, which shows as a payment without a live invoice.

## Currency conversions

If the differences are all small and spread over many accounts, suspect conversion. Compare the rate used at pricing time with the rate used at capture; differences under 0.2 percent are expected and are cleared by a rounding adjustment entry made by finance.

## Closing the ticket

Never close a reconciliation ticket by editing the ledger. Ask finance for an adjustment entry, record its reference in the ticket and let the next night's run confirm the difference is gone.

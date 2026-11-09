# Billing Operator Notes

Notes for the person watching the invoice run and the payment retries. The run is boring when it works and expensive when it does not, so these notes lean towards caution.

## The invoice run

Invoices are produced once a day at 03:10 UTC for every account whose billing day is today. The run reads usage totals that were frozen at midnight, prices them against the plan in force on the billing day, and writes draft invoices. Drafts are finalised by a second job an hour later. If the first job is late the second job simply finds nothing to finalise, which is not an error; it will pick the drafts up the next day, which is why a late run is visible to customers as a one-day delay.

## Proration rules

A plan change in the middle of a period is prorated by whole days, counted from the day after the change. The unused part of the old plan becomes a credit line and the used part of the new plan a charge line, on the next invoice. Downgrades never produce a refund to the card on their own; the credit stays on the account. Support often asks for an exception, and the answer is to issue a credit note rather than change the proration.

## Tax rounding

Tax is computed per line and rounded half up to the cent, then summed. Some regions require rounding on the invoice total instead, and for those the tax profile carries a flag. Do not fix a one-cent difference by editing an invoice; the difference is almost always the rounding mode, and finance wants it left visible.

## Failed charge retries

When a card charge fails the account enters dunning. The platform retries on a fixed schedule and gives up after the number of attempts set in BILLING_DUNNING_MAX_ATTEMPTS, which is 5 by default. Between attempts the customer receives a reminder email, and after the last attempt the account is moved to read-only. Do not retry by hand while an automatic attempt is pending; two simultaneous charges for one invoice is the one incident that always becomes a refund conversation.

## Credit notes

A credit note reduces what a customer owes without touching the original invoice. Only finance and the billing lead can issue one above 500 dollars; support can issue smaller ones from the console. Every credit note needs a reason code, because the quarterly audit samples them by reason.

## Month-end freeze

On the last business day of the month finance freezes the ledger at 17:00 UTC. Anything that posts after the freeze lands in the next month, including late usage. The only changes allowed during the freeze are corrections requested in writing by the controller. Operators should avoid starting migrations that touch invoice tables in the three days around month end.

## Ledger reconciliation

Every night the ledger totals are compared with the sum of finalised invoices and captured payments. A mismatch above one dollar opens a ticket automatically. The common causes are a payment captured after the invoice was voided, and a currency conversion whose rate changed between pricing and capture. The longer reconciliation procedure lives in its own guide.

## Currency handling

Prices are stored in the plan currency. Customers billed in another currency see a converted amount using the rate frozen on the billing day. The rate is never refreshed mid-run, so a customer comparing two invoices a day apart can legitimately see different conversions.

## Audit exports

The audit export is a nightly file of every invoice event: created, finalised, voided, paid, credited. It is written to cold storage and kept seven years. Do not change its column order without telling the auditors, since their tooling reads columns by position.

## Escalation

Anything that charges a customer twice, or fails to charge a whole region, is a severity-one incident. Page the billing lead directly, and open the incident channel before you start fixing, so the timeline is written as it happens.

## Usage freezing

Usage totals are frozen at midnight UTC for the invoice run. Events that arrive after midnight for the previous day are rolled into the next day's totals, not patched into a frozen one. A customer who sent a late backfill will therefore see the usage on the following invoice. This is intentional; patching frozen totals would change numbers a customer has already seen on a draft.

## Plan catalogue changes

Prices change only on the first of a month and only through the catalogue change process: a pull request against the catalogue repository, review by the pricing owner, and a scheduled activation. Operators must not edit a live plan directly in the console, even when the console lets them, because the invoice run caches the catalogue per day and an edit mid-run produces a mixed invoice.

## Voiding and reissuing

An invoice can be voided only while it is unpaid. A voided invoice cannot be reopened; reissue a corrected one, and let the system link the two. Finance wants every void to carry the ticket number in the memo field, since the audit sample asks for the ticket first.

## Refunds

Refunds go back to the original payment method and are initiated from the payment record, not from the invoice. A refund above the captured amount is refused by the processor. Partial refunds are allowed up to six times per payment. Refunds take three to ten business days to appear for the customer, and customers will ask support before the money arrives.

## Payment processor outages

When the card processor is degraded the platform automatically pauses the dunning schedule so customers are not penalised for our provider's outage. The pause is lifted by hand after the processor reports recovery, and the lift has to be done before the next dunning window or a day of retries is lost. Record the pause and the lift in the incident channel.

## Test and sandbox accounts

Sandbox accounts are billed in a separate ledger that never reaches finance. The usual mistake is an internal demo account created in the production ledger, which then appears in the revenue report. The monthly cleanup job lists accounts with the demo flag in production and the billing lead reviews the list.

## Customer-facing numbers

When a customer questions an invoice, compare three things in this order: the frozen usage totals, the plan in force on the billing day, and the proration lines. Nine times out of ten the difference is one of these, and none of them requires an engineer.

## Annual plans

Annual customers are invoiced once, on the anniversary, and the invoice run treats them like any other account on their billing day. Mid-year upgrades are prorated by day against the remaining term. An annual customer who cancels early gets no refund of the unused term unless the contract says so; the contract field on the account is the only source, so look there before answering support.

## Usage alerts to customers

Customers on metered plans can set spend alerts. The alert checker reads the same frozen totals as the invoice run, so it lags by up to a day. A customer who exceeds their alert threshold at noon will not be told until the next morning. Support should explain the lag, not promise real-time alerts.

## Handover notes

At the end of a shift, record the state of the invoice run, any dunning pauses in effect, and any credit notes above the support limit that are awaiting finance. The next operator should never have to guess whether a pause is still on.

## Regional invoicing rules

Some countries require sequential invoice numbers with no gaps. For those, a voided draft still consumes a number, and the finance team keeps a register of voided numbers for the tax authority. Operators who delete a draft in those regions are creating a compliance problem, not tidying up.

## Taxes on credits

A credit note reverses tax in proportion to the amount credited, using the rate on the original invoice, not today's rate. This matters when a region changed its rate between the invoice and the credit; finance will ask why the reversal uses the old rate, and the answer is that the tax authority expects exactly that.

## Contacts

The billing lead owns decisions about exceptions. Finance owns anything touching the ledger and the controller owns the freeze. Support owns customer communication. Operators own the run and the retries, and escalate in that order.

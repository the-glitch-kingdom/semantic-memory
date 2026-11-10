# Nightly ledger schedule

The nightly job runs audit_ledger.sh at 02:00 on the build host, just ahead of the ledger report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the ledger area only after two missed nights in a row; one late night needs no action.

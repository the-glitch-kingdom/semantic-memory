# Ledger tooling notes

- Added audit_ledger.sh to the ledger tooling. It checks that the ledger export balances against the payment totals.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds a ledger that is out of balance.

# Quota tooling notes

- Added validate_quotas.py to the quota tooling. It checks that tenant quotas add up to less than the pool size.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds quotas that overcommit the pool.

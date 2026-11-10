# Seal tooling notes

- Added verify_seals.sh to the seal tooling. It checks that every release artifact carries a valid signing seal.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds an artifact with a broken seal.

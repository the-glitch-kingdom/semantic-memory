# Schema tooling notes

- Added lint_schemas.py to the schema tooling. It checks that every event schema declares a compatibility mode.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds a schema with no compatibility mode.

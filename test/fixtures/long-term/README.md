Fixtures for long-term memory (#93), in the hit-em-with-the-docs#97 contract shape.
`cold-a/` and `cold-b/` are copied to `.documentation-cold/2026-01-15/` and `.documentation-cold/2026-03-01-2/`;
`hewtd-config.json` goes to `.claude/hit-em-with-the-docs.json`. `__CHECKSUM__` and `__FAKE_SECRET__` are filled at
test time (test/long-term-fixture.ts); no credential-shaped value is committed.

# Return values and what they verify

A script's return value is part of its interface. A zero return verifies that the whole run succeeded; any other value says what kind of failure it was. Callers should check the return value before they trust the output, and wrappers should pass the exit code through unchanged instead of replacing it with 1.

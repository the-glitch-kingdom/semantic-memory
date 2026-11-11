# Exit codes: what each check returns

Every verification script in the repository exits 0 when everything checked is fine and a non-zero code when it is not. Exit 1 means a check failed, exit 2 means the script was called with bad arguments, and exit 3 means it could not read its input. What the script verifies is listed in the check catalogue; this page only explains what each exit code returns to the caller and how CI treats it.

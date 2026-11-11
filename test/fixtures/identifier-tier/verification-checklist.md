# What does the verification step check?

The release verification step runs a fixed list of checks and reports what each one verifies and what it returns. A check that verifies its input and returns 0 passes. A check that finds a problem returns 1 and prints the first failing item. The step stops at the first failing check unless it is run with the keep-going flag, and then it returns the highest exit code it saw.

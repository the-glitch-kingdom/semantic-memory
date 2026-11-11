# Scripts exit 0 on success

Our scripts return 0 when the work is done and the checks pass. They verify their inputs first, then act, then return. If you write a new script, make it verify before it changes anything and make it return a non-zero exit code on failure, so that callers and CI can tell what happened.

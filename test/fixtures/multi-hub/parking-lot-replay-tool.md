# Parking Topic Replay Tool

The replay tool moves events out of the parking topic back into the ingest pipeline once the cause of their failure is fixed. It is a command line program run from the operations host, and it is deliberately conservative.

## Basic use

Run the tool with the tenant name and a time range. By default it only reads and prints how many events it would move; add the apply flag to do it. It refuses to run for a tenant whose shaping failure rate is still above two percent, since that means the cause is not fixed.

## Age limit

Events older than the age limit are skipped. The default limit is 72 hours, written as the flag --max-age 72h, and it can be raised to the full fourteen days only with the second on-call's approval, because very old events can trip the clock skew rule and bounce again.

## Output

The tool writes a manifest of the event ids it replayed. Keep the manifest with the incident ticket: it is the only proof of what was replayed, and a second run can use it to avoid replaying the same events twice.

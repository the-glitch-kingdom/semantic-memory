# Audit log retention

Where the audit logs are kept, for how long, and who can read them.

## Where the audit logs are kept

The audit logs are kept in the cold bucket named audit-archive, one folder per month. Audit logs are written once and never edited. The audit logs of the last thirty days are also kept on the hot disks of the log servers.

## Who can read audit logs

Only the security team and the auditors can read the audit logs. Access is granted per quarter and reviewed at the quarter's end.

## Retention periods

Audit logs are kept for seven years. After that they are deleted by the monthly cleanup job.

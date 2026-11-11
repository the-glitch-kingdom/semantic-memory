# Platform handover notes

Notes the outgoing on-call writes for the next one. Short sections, one topic each.

## Certificates

The cluster certificates are rotated every sixty days by whoever is on call. The runbook is linked from the wiki. Check the expiry dates on the first day of your shift and write them in the handover thread.

## Audit logs

The audit logs are kept in the archive bucket and nowhere else once they are older than a month. If someone asks for a log from last year, ask the security team to fetch it from the bucket.

## Monitoring

Dashboards live in the monitoring tool. Alerts go to the pager. A silenced alert must have a ticket number in its note.

## Deploys

Deploys happen on weekdays. The deploy captain posts in the release channel before starting and after finishing.

## Vendors

Contract renewals are tracked by the platform lead. Ask before you sign up for a new tool.

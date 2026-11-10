# Nightly quota schedule

The nightly job runs validate_quotas.py at 02:00 on the build host, just ahead of the quota report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the quota area only after two missed nights in a row; one late night needs no action.

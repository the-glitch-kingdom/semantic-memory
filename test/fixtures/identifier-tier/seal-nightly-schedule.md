# Nightly seal schedule

The nightly job runs verify_seals.sh at 02:00 on the build host, just ahead of the seal report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the seal area only after two missed nights in a row; one late night needs no action.

# Nightly gateway schedule

The nightly job runs probe_gateways.sh at 02:00 on the build host, just ahead of the gateway report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the gateway area only after two missed nights in a row; one late night needs no action.

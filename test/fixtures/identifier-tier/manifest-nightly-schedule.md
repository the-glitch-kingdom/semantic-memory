# Nightly manifest schedule

The nightly job runs scan_manifests.py at 02:00 on the build host, just ahead of the manifest report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the manifest area only after two missed nights in a row; one late night needs no action.

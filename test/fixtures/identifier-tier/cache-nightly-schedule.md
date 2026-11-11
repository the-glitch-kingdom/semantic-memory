# Nightly cache schedule

The nightly job runs sweep_caches.sh at 02:00 on the build host, just ahead of the cache report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the cache area only after two missed nights in a row; one late night needs no action.

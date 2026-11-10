# Nightly schema schedule

The nightly job runs lint_schemas.py at 02:00 on the build host, just ahead of the schema report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the schema area only after two missed nights in a row; one late night needs no action.

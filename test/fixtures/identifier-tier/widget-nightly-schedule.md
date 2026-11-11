# Nightly widget schedule

The nightly job runs check_widgets.py at 02:00 on the build host, just ahead of the widget report. When the host is busy it queues behind the packaging job and may start late. Page the owner of the widget area only after two missed nights in a row; one late night needs no action.

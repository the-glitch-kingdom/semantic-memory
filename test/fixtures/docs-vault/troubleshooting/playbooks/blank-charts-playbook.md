---
title: Blank charts playbook
tags: [playbook, storage]
domain: troubleshooting
type: playbook
symptoms:
  - alert_name: RollupJobSkipped
    target: rollup-job
    cites: [clock-drift-reorders-positions]
    severity: warning
  - user_phrase: charts go empty for yesterday
    target: rollup-job
    cites: [clock-drift-reorders-positions]
    severity: warning
  - error_pattern: "ERR_ROLLUP_MISSING"
    target: rollup-job
    cites: [clock-drift-reorders-positions]
    severity: warning
---

# Blank charts playbook

The downsampling job did not run for the affected window, so the cold-path queries find nothing to
draw. Run it again by hand with `tidewatch rollup --day <date>` and reload the page.

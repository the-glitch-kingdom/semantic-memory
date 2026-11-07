---
title: Consumer lag playbook
tags: [playbook, ingest]
domain: troubleshooting
type: playbook
symptoms:
  - alert_name: HarborBacklogHigh
    target: pier-workers
    cites: [mqtt-retained-flag-replays]
    severity: critical
  - user_phrase: the live screen shows readings from an hour ago
    target: pier-workers
    cites: [mqtt-retained-flag-replays]
    severity: warning
  - user_phrase:
      - data on the map is out of date
      - positions arrive much later than the boat sent them
    target: pier-workers
    cites: [mqtt-retained-flag-replays]
    severity: warning
  - error_pattern: "rebalance.*timed out after \\d+ms"
    target: pier-workers
    cites: [mqtt-retained-flag-replays]
    severity: critical
---

# Consumer lag playbook

A member of the consumer group that still owns partitions but commits no offsets is wedged. List
group membership, find the member whose offset has not moved for ten minutes and evict it with
`tidewatch consumers evict <member>`. The remaining members take over its partitions and the
offsets advance again within a minute.

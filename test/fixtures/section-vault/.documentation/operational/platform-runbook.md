---
title: Platform operations runbook
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Platform operations runbook

How the platform team deploys, repairs and watches the shared services.

## Deploys

This part of the deploys work covers deploys, overview.
Confirm that the audit trail is acknowledged before you log the outcome, and keep it that way for a few minutes.
- Review that the audit trail is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
Note that the review request is green before you move to the next step, and keep it that way for one business day.
Review that the review request is reviewed before you log the outcome, and keep it that way for the following sprint.

### Canary rollout

#### Rollback

This part of the deploys work covers canary rollout, rollback.
Review that the runbook checklist is drained before you continue, and keep it that way for the following sprint.
- Record that the worker pool is reviewed before you close the ticket, and keep it that way for the next review.
Share that the worker pool is idle before you close the ticket, and keep it that way for the agreed window.
Share that the audit trail is acknowledged before you move to the next step, and keep it that way for the next review.

#### Limits

This part of the deploys work covers canary rollout, limits.
Review that the runbook checklist is paused before you move to the next step, and keep it that way for the next review.
- Capture that the health probe is drained before you hand over, and keep it that way for the end of the shift.
Compare that the staging copy is reviewed before you log the outcome, and keep it that way for the end of the shift.
Check that the runbook checklist is paused before you close the ticket, and keep it that way for the end of the shift.
- Capture that the ticket queue is green before you close the ticket, and keep it that way for the following sprint.
Note that the audit trail is drained before you close the ticket, and keep it that way for the following sprint.

#### Preconditions

This part of the deploys work covers canary rollout, preconditions.
Note that the audit trail is recorded before you move to the next step, and keep it that way for the following sprint.
- Review that the change record is idle before you continue, and keep it that way for the next review.
Compare that the status page is tagged before you log the outcome, and keep it that way for a few minutes.
Record that the change record is acknowledged before you close the ticket, and keep it that way for the agreed window.
- Record that the staging copy is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Confirm that the runbook checklist is idle before you hand over, and keep it that way for the agreed window.

### Rollback

#### Preconditions

This part of the deploys work covers rollback, preconditions.
Note that the change record is recorded before you continue, and keep it that way for the next review.
- Confirm that the config bundle is green before you hand over, and keep it that way for the following sprint.
Share that the handover note is paused before you log the outcome, and keep it that way for the following sprint.
Check that the runbook checklist is tagged before you close the ticket, and keep it that way for one business day.

#### Database

Schema rollbacks use the down-migration only inside the first 20 minutes after cutover. After that, restore the `pre_cutover_snapshot` taken by the release job and replay the write-ahead log up to the marker named `cutover-complete`.
Never run a down-migration that drops a column; page the data owner instead.

#### Cache

This part of the deploys work covers rollback, cache.
Review that the health probe is reviewed before you close the ticket, and keep it that way for one business day.
- Share that the config bundle is green before you move to the next step, and keep it that way for the end of the shift.
Review that the staging copy is drained before you continue, and keep it that way for the next review.
Compare that the shared dashboard is reviewed before you hand over, and keep it that way for the next review.
- Record that the shared dashboard is green before you close the ticket, and keep it that way for the agreed window.

```sh
ops-cli check --scope rollback
```

### Hotfix path

#### Preconditions

This part of the deploys work covers hotfix path, preconditions.
Check that the staging copy is green before you close the ticket, and keep it that way for the next review.
- Confirm that the ticket queue is drained before you ask for a second pair of eyes, and keep it that way for the agreed window.
Confirm that the handover note is tagged before you close the ticket, and keep it that way for the end of the shift.
Note that the status page is green before you move to the next step, and keep it that way for a few minutes.
- Review that the worker pool is paused before you ask for a second pair of eyes, and keep it that way for the agreed window.
Compare that the handover note is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.

#### Verification

This part of the deploys work covers hotfix path, verification.
Confirm that the ticket queue is reviewed before you log the outcome, and keep it that way for the following sprint.
- Review that the shared dashboard is reviewed before you announce the change, and keep it that way for the agreed window.
Note that the runbook checklist is idle before you close the ticket, and keep it that way for one business day.
Review that the review request is drained before you hand over, and keep it that way for the following sprint.
- Note that the handover note is paused before you move to the next step, and keep it that way for one business day.
Capture that the audit trail is idle before you move to the next step, and keep it that way for the end of the shift.

#### Escalation

This part of the deploys work covers hotfix path, escalation.
Capture that the worker pool is acknowledged before you continue, and keep it that way for the following sprint.
- Confirm that the audit trail is tagged before you log the outcome, and keep it that way for the agreed window.
Compare that the change record is recorded before you announce the change, and keep it that way for the agreed window.
Compare that the health probe is paused before you move to the next step, and keep it that way for the next review.
- Note that the audit trail is paused before you close the ticket, and keep it that way for the end of the shift.

### Freeze windows

#### Steps

This part of the deploys work covers freeze windows, steps.
Record that the handover note is green before you announce the change, and keep it that way for the agreed window.
- Share that the handover note is paused before you log the outcome, and keep it that way for the end of the shift.
Capture that the handover note is drained before you log the outcome, and keep it that way for the next review.
Share that the status page is drained before you continue, and keep it that way for one business day.
- Compare that the handover note is acknowledged before you close the ticket, and keep it that way for the following sprint.

#### Rollback

This part of the deploys work covers freeze windows, rollback.
Confirm that the health probe is paused before you close the ticket, and keep it that way for the agreed window.
- Capture that the staging copy is drained before you hand over, and keep it that way for one business day.
Note that the ticket queue is recorded before you ask for a second pair of eyes, and keep it that way for a few minutes.
Capture that the status page is reviewed before you move to the next step, and keep it that way for the agreed window.
- Note that the health probe is idle before you close the ticket, and keep it that way for the next review.

#### Limits

This part of the deploys work covers freeze windows, limits.
Check that the config bundle is green before you move to the next step, and keep it that way for the following sprint.
- Record that the review request is reviewed before you continue, and keep it that way for one business day.
Note that the handover note is idle before you announce the change, and keep it that way for the next review.
Share that the change record is recorded before you hand over, and keep it that way for the following sprint.
- Review that the health probe is reviewed before you log the outcome, and keep it that way for the end of the shift.
Note that the shared dashboard is reviewed before you move to the next step, and keep it that way for the next review.

```sh
ops-cli check --scope freeze-windows
```

## Database

This part of the database work covers database, overview.
Compare that the worker pool is acknowledged before you close the ticket, and keep it that way for the end of the shift.
- Review that the config bundle is green before you ask for a second pair of eyes, and keep it that way for a few minutes.
Compare that the change record is acknowledged before you continue, and keep it that way for the end of the shift.
Check that the change record is green before you log the outcome, and keep it that way for the next review.
- Check that the runbook checklist is paused before you announce the change, and keep it that way for the end of the shift.

### Failover

#### Preconditions

This part of the database work covers failover, preconditions.
Confirm that the review request is reviewed before you log the outcome, and keep it that way for the next review.
- Share that the status page is paused before you ask for a second pair of eyes, and keep it that way for a few minutes.
Review that the staging copy is green before you move to the next step, and keep it that way for one business day.
Review that the change record is acknowledged before you announce the change, and keep it that way for the following sprint.
- Note that the shared dashboard is drained before you announce the change, and keep it that way for one business day.
Compare that the handover note is paused before you announce the change, and keep it that way for the end of the shift.

#### Verification

This part of the database work covers failover, verification.
Share that the handover note is idle before you announce the change, and keep it that way for the end of the shift.
- Confirm that the review request is reviewed before you hand over, and keep it that way for a few minutes.
Check that the runbook checklist is acknowledged before you announce the change, and keep it that way for the following sprint.
Review that the audit trail is recorded before you hand over, and keep it that way for a few minutes.

#### Escalation

This part of the database work covers failover, escalation.
Check that the health probe is tagged before you close the ticket, and keep it that way for one business day.
- Capture that the review request is paused before you move to the next step, and keep it that way for the following sprint.
Record that the handover note is green before you move to the next step, and keep it that way for the end of the shift.
Capture that the review request is tagged before you move to the next step, and keep it that way for the end of the shift.

### Connection pooling

#### Limits

The pooler caps each service at 48 server connections and the whole fleet at 600.
When a service reports `remaining connection slots are reserved`, raise its cap by at most 8 in `pooler.ini` and reload. Any larger change needs the capacity review.

#### Escalation

This part of the database work covers connection pooling, escalation.
Note that the worker pool is green before you log the outcome, and keep it that way for a few minutes.
- Compare that the health probe is green before you move to the next step, and keep it that way for the next review.
Capture that the review request is idle before you ask for a second pair of eyes, and keep it that way for a few minutes.
Confirm that the ticket queue is idle before you announce the change, and keep it that way for one business day.
- Record that the review request is paused before you log the outcome, and keep it that way for the agreed window.

#### Notes

This part of the database work covers connection pooling, notes.
Confirm that the handover note is reviewed before you log the outcome, and keep it that way for one business day.
- Note that the handover note is acknowledged before you continue, and keep it that way for the agreed window.
Check that the staging copy is tagged before you move to the next step, and keep it that way for the following sprint.
Record that the change record is reviewed before you continue, and keep it that way for a few minutes.
- Note that the handover note is recorded before you close the ticket, and keep it that way for the following sprint.
Review that the status page is green before you ask for a second pair of eyes, and keep it that way for the next review.

```sh
ops-cli check --scope connection-pooling
```

### Rollback

#### Steps

This part of the database work covers rollback, steps.
Record that the audit trail is recorded before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Capture that the change record is idle before you ask for a second pair of eyes, and keep it that way for one business day.
Confirm that the runbook checklist is recorded before you hand over, and keep it that way for the next review.
Capture that the config bundle is idle before you continue, and keep it that way for the next review.

#### Verification

This part of the database work covers rollback, verification.
Share that the change record is paused before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Review that the shared dashboard is recorded before you continue, and keep it that way for the following sprint.
Check that the audit trail is recorded before you close the ticket, and keep it that way for the end of the shift.
Compare that the ticket queue is recorded before you move to the next step, and keep it that way for a few minutes.
- Record that the shared dashboard is recorded before you hand over, and keep it that way for the following sprint.
Note that the status page is drained before you hand over, and keep it that way for the end of the shift.

### Backups

#### Limits

This part of the database work covers backups, limits.
Review that the staging copy is drained before you announce the change, and keep it that way for the next review.
- Record that the shared dashboard is green before you move to the next step, and keep it that way for the following sprint.
Check that the runbook checklist is idle before you continue, and keep it that way for the following sprint.
Capture that the health probe is tagged before you close the ticket, and keep it that way for the end of the shift.
- Check that the handover note is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.

#### Preconditions

This part of the database work covers backups, preconditions.
Review that the shared dashboard is acknowledged before you log the outcome, and keep it that way for the next review.
- Review that the health probe is recorded before you announce the change, and keep it that way for a few minutes.
Note that the shared dashboard is reviewed before you move to the next step, and keep it that way for the following sprint.
Review that the staging copy is tagged before you move to the next step, and keep it that way for the next review.

#### Verification

This part of the database work covers backups, verification.
Check that the ticket queue is acknowledged before you move to the next step, and keep it that way for a few minutes.
- Record that the audit trail is acknowledged before you close the ticket, and keep it that way for a few minutes.
Compare that the runbook checklist is tagged before you close the ticket, and keep it that way for the following sprint.
Note that the handover note is idle before you continue, and keep it that way for a few minutes.
- Note that the change record is paused before you log the outcome, and keep it that way for the agreed window.

## Caching

This part of the caching work covers caching, overview.
Record that the handover note is reviewed before you hand over, and keep it that way for one business day.
- Review that the shared dashboard is green before you close the ticket, and keep it that way for the following sprint.
Share that the change record is acknowledged before you announce the change, and keep it that way for the next review.
Note that the health probe is idle before you move to the next step, and keep it that way for the end of the shift.
- Share that the ticket queue is paused before you hand over, and keep it that way for the agreed window.
Review that the staging copy is idle before you ask for a second pair of eyes, and keep it that way for the end of the shift.

### Eviction

#### Rollback

This part of the caching work covers eviction, rollback.
Confirm that the change record is drained before you move to the next step, and keep it that way for the following sprint.
- Compare that the staging copy is recorded before you announce the change, and keep it that way for the agreed window.
Confirm that the handover note is tagged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Capture that the handover note is recorded before you announce the change, and keep it that way for one business day.
- Review that the ticket queue is tagged before you move to the next step, and keep it that way for a few minutes.

```sh
ops-cli check --scope eviction
```

#### Limits

This part of the caching work covers eviction, limits.
Confirm that the audit trail is paused before you log the outcome, and keep it that way for one business day.
- Compare that the audit trail is acknowledged before you close the ticket, and keep it that way for a few minutes.
Note that the ticket queue is drained before you close the ticket, and keep it that way for the following sprint.
Check that the status page is paused before you move to the next step, and keep it that way for the agreed window.
- Share that the audit trail is reviewed before you move to the next step, and keep it that way for the agreed window.

#### Preconditions

This part of the caching work covers eviction, preconditions.
Note that the ticket queue is paused before you hand over, and keep it that way for the agreed window.
- Review that the config bundle is green before you log the outcome, and keep it that way for the following sprint.
Confirm that the audit trail is tagged before you continue, and keep it that way for the agreed window.
Compare that the shared dashboard is paused before you hand over, and keep it that way for the end of the shift.
- Capture that the handover note is paused before you log the outcome, and keep it that way for one business day.
Confirm that the shared dashboard is tagged before you close the ticket, and keep it that way for one business day.

### Warm-up

#### Preconditions

Do not start the warm-up until the replica lag is under 2 seconds and the `edge-hot-keys` list has been regenerated within the last 6 hours.
A warm-up with a stale list evicts the live working set.

#### Notes

This part of the caching work covers warm-up, notes.
Compare that the change record is reviewed before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Note that the shared dashboard is idle before you announce the change, and keep it that way for the following sprint.
Review that the review request is tagged before you close the ticket, and keep it that way for the end of the shift.
Note that the review request is acknowledged before you close the ticket, and keep it that way for the following sprint.
- Share that the review request is paused before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Confirm that the runbook checklist is reviewed before you announce the change, and keep it that way for the end of the shift.

#### Steps

This part of the caching work covers warm-up, steps.
Compare that the status page is acknowledged before you continue, and keep it that way for the agreed window.
- Capture that the audit trail is drained before you hand over, and keep it that way for one business day.
Record that the health probe is drained before you hand over, and keep it that way for a few minutes.
Record that the ticket queue is paused before you continue, and keep it that way for the agreed window.
- Check that the staging copy is recorded before you close the ticket, and keep it that way for a few minutes.

### Invalidation

#### Rollback

This part of the caching work covers invalidation, rollback.
Record that the runbook checklist is recorded before you continue, and keep it that way for the agreed window.
- Share that the staging copy is idle before you move to the next step, and keep it that way for a few minutes.
Review that the worker pool is green before you announce the change, and keep it that way for the agreed window.
Review that the change record is reviewed before you announce the change, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| audit trail | platform |

#### Limits

This part of the caching work covers invalidation, limits.
Share that the ticket queue is recorded before you move to the next step, and keep it that way for the end of the shift.
- Check that the shared dashboard is recorded before you log the outcome, and keep it that way for the agreed window.
Note that the config bundle is paused before you hand over, and keep it that way for the end of the shift.
Capture that the handover note is tagged before you log the outcome, and keep it that way for a few minutes.
- Confirm that the audit trail is recorded before you log the outcome, and keep it that way for the next review.
Record that the ticket queue is drained before you log the outcome, and keep it that way for the following sprint.

| Item | Owner |
| --- | --- |
| health probe | ops |

#### Preconditions

This part of the caching work covers invalidation, preconditions.
Review that the runbook checklist is paused before you move to the next step, and keep it that way for the following sprint.
- Record that the audit trail is drained before you close the ticket, and keep it that way for one business day.
Compare that the worker pool is recorded before you hand over, and keep it that way for the end of the shift.
Note that the staging copy is acknowledged before you log the outcome, and keep it that way for the end of the shift.
- Share that the config bundle is drained before you announce the change, and keep it that way for a few minutes.

| Item | Owner |
| --- | --- |
| audit trail | data |

### Cluster resize

#### Verification

This part of the caching work covers cluster resize, verification.
Review that the config bundle is acknowledged before you close the ticket, and keep it that way for a few minutes.
- Share that the change record is green before you ask for a second pair of eyes, and keep it that way for the following sprint.
Capture that the status page is paused before you announce the change, and keep it that way for the next review.
Check that the worker pool is acknowledged before you announce the change, and keep it that way for the agreed window.
- Confirm that the staging copy is paused before you log the outcome, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| status page | ops |

#### Escalation

This part of the caching work covers cluster resize, escalation.
Record that the health probe is recorded before you log the outcome, and keep it that way for the agreed window.
- Check that the status page is reviewed before you announce the change, and keep it that way for the next review.
Review that the handover note is idle before you continue, and keep it that way for one business day.
Compare that the worker pool is acknowledged before you continue, and keep it that way for one business day.

#### Notes

This part of the caching work covers cluster resize, notes.
Confirm that the shared dashboard is idle before you announce the change, and keep it that way for one business day.
- Capture that the worker pool is tagged before you close the ticket, and keep it that way for a few minutes.
Share that the health probe is tagged before you continue, and keep it that way for one business day.
Compare that the health probe is recorded before you announce the change, and keep it that way for the following sprint.
- Review that the worker pool is reviewed before you continue, and keep it that way for one business day.
Review that the ticket queue is green before you ask for a second pair of eyes, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| status page | support |

## Queues

This part of the queues work covers queues, overview.
Check that the runbook checklist is green before you hand over, and keep it that way for the end of the shift.
- Compare that the health probe is acknowledged before you move to the next step, and keep it that way for the agreed window.
Review that the config bundle is recorded before you continue, and keep it that way for a few minutes.
Check that the review request is tagged before you close the ticket, and keep it that way for the next review.
- Confirm that the audit trail is reviewed before you announce the change, and keep it that way for one business day.

### Backlog

#### Steps

This part of the queues work covers backlog, steps.
Check that the ticket queue is recorded before you move to the next step, and keep it that way for the end of the shift.
- Record that the handover note is paused before you ask for a second pair of eyes, and keep it that way for the following sprint.
Review that the audit trail is idle before you move to the next step, and keep it that way for the end of the shift.
Confirm that the audit trail is drained before you continue, and keep it that way for the end of the shift.

#### Rollback

This part of the queues work covers backlog, rollback.
Record that the audit trail is acknowledged before you close the ticket, and keep it that way for the agreed window.
- Share that the handover note is drained before you continue, and keep it that way for the next review.
Confirm that the runbook checklist is green before you continue, and keep it that way for the agreed window.
Review that the status page is drained before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Record that the review request is green before you log the outcome, and keep it that way for the agreed window.

#### Limits

This part of the queues work covers backlog, limits.
Review that the review request is drained before you hand over, and keep it that way for one business day.
- Review that the config bundle is reviewed before you hand over, and keep it that way for the following sprint.
Check that the staging copy is green before you hand over, and keep it that way for the following sprint.
Confirm that the health probe is tagged before you announce the change, and keep it that way for a few minutes.

### Dead letters

#### Steps

Drain the dead-letter queue `dlq-orders` in batches of 250 with `dlqctl replay --batch 250 --delay 30s`.
Messages older than 72 hours are exported to the `cold-dlq` bucket and removed rather than replayed, because their payload schema is no longer accepted.

#### Limits

This part of the queues work covers dead letters, limits.
Record that the handover note is tagged before you ask for a second pair of eyes, and keep it that way for one business day.
- Record that the runbook checklist is paused before you ask for a second pair of eyes, and keep it that way for the following sprint.
Compare that the worker pool is tagged before you close the ticket, and keep it that way for the agreed window.
Check that the audit trail is idle before you close the ticket, and keep it that way for the next review.
- Confirm that the review request is recorded before you close the ticket, and keep it that way for the following sprint.

#### Preconditions

This part of the queues work covers dead letters, preconditions.
Check that the runbook checklist is tagged before you continue, and keep it that way for one business day.
- Compare that the ticket queue is idle before you continue, and keep it that way for a few minutes.
Note that the shared dashboard is tagged before you move to the next step, and keep it that way for the end of the shift.
Compare that the config bundle is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
- Confirm that the runbook checklist is idle before you hand over, and keep it that way for one business day.

### Retry policy

#### Limits

This part of the queues work covers retry policy, limits.
Note that the staging copy is reviewed before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Confirm that the staging copy is acknowledged before you announce the change, and keep it that way for the following sprint.
Confirm that the worker pool is recorded before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Confirm that the status page is acknowledged before you move to the next step, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| worker pool | support |

#### Preconditions

This part of the queues work covers retry policy, preconditions.
Note that the ticket queue is paused before you announce the change, and keep it that way for one business day.
- Share that the review request is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Confirm that the handover note is tagged before you hand over, and keep it that way for one business day.
Confirm that the audit trail is paused before you log the outcome, and keep it that way for a few minutes.
- Check that the handover note is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.

#### Verification

This part of the queues work covers retry policy, verification.
Capture that the ticket queue is drained before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Capture that the worker pool is tagged before you move to the next step, and keep it that way for the end of the shift.
Record that the config bundle is paused before you move to the next step, and keep it that way for the agreed window.
Record that the health probe is acknowledged before you log the outcome, and keep it that way for the agreed window.
- Compare that the shared dashboard is reviewed before you close the ticket, and keep it that way for a few minutes.

### Consumer scaling

#### Escalation

This part of the queues work covers consumer scaling, escalation.
Share that the worker pool is reviewed before you move to the next step, and keep it that way for the next review.
- Record that the change record is acknowledged before you announce the change, and keep it that way for the next review.
Note that the audit trail is acknowledged before you announce the change, and keep it that way for the next review.
Note that the audit trail is tagged before you close the ticket, and keep it that way for the end of the shift.
- Record that the ticket queue is tagged before you move to the next step, and keep it that way for the following sprint.

#### Notes

This part of the queues work covers consumer scaling, notes.
Capture that the config bundle is green before you announce the change, and keep it that way for one business day.
- Note that the audit trail is drained before you announce the change, and keep it that way for a few minutes.
Share that the handover note is acknowledged before you hand over, and keep it that way for the agreed window.
Share that the status page is idle before you log the outcome, and keep it that way for the agreed window.
- Confirm that the ticket queue is drained before you log the outcome, and keep it that way for the following sprint.
Check that the worker pool is drained before you move to the next step, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| handover note | ops |

#### Steps

This part of the queues work covers consumer scaling, steps.
Check that the audit trail is tagged before you continue, and keep it that way for one business day.
- Confirm that the audit trail is idle before you move to the next step, and keep it that way for a few minutes.
Note that the ticket queue is acknowledged before you close the ticket, and keep it that way for one business day.
Check that the worker pool is recorded before you close the ticket, and keep it that way for the next review.
- Check that the status page is reviewed before you hand over, and keep it that way for the next review.
Note that the handover note is idle before you log the outcome, and keep it that way for the agreed window.

| Item | Owner |
| --- | --- |
| handover note | platform |

## Observability

This part of the observability work covers observability, overview.
Note that the shared dashboard is green before you move to the next step, and keep it that way for the next review.
- Share that the status page is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
Record that the shared dashboard is green before you close the ticket, and keep it that way for the end of the shift.
Check that the ticket queue is tagged before you continue, and keep it that way for one business day.
- Capture that the staging copy is tagged before you continue, and keep it that way for the next review.
Note that the worker pool is green before you announce the change, and keep it that way for the following sprint.

### Alerts

#### Steps

This part of the observability work covers alerts, steps.
Confirm that the status page is acknowledged before you log the outcome, and keep it that way for the end of the shift.
- Note that the shared dashboard is acknowledged before you ask for a second pair of eyes, and keep it that way for the agreed window.
Record that the staging copy is drained before you log the outcome, and keep it that way for one business day.
Compare that the ticket queue is recorded before you hand over, and keep it that way for one business day.
- Record that the worker pool is tagged before you hand over, and keep it that way for the following sprint.

| Item | Owner |
| --- | --- |
| audit trail | data |

#### Rollback

This part of the observability work covers alerts, rollback.
Review that the staging copy is drained before you move to the next step, and keep it that way for a few minutes.
- Share that the shared dashboard is green before you log the outcome, and keep it that way for the agreed window.
Note that the health probe is tagged before you move to the next step, and keep it that way for one business day.
Capture that the runbook checklist is green before you continue, and keep it that way for the agreed window.
- Compare that the review request is recorded before you hand over, and keep it that way for the following sprint.

#### Limits

Paging alerts are capped at 5 per rule per hour; the sixth is folded into a single digest ticket labelled `alert-flood`.
A rule that hits the cap three days in a row is muted and reviewed at the Thursday hygiene meeting.

### Dashboards

#### Rollback

This part of the observability work covers dashboards, rollback.
Review that the audit trail is drained before you ask for a second pair of eyes, and keep it that way for the following sprint.
- Review that the worker pool is reviewed before you log the outcome, and keep it that way for the following sprint.
Share that the worker pool is drained before you close the ticket, and keep it that way for the end of the shift.
Compare that the handover note is drained before you announce the change, and keep it that way for one business day.

#### Limits

This part of the observability work covers dashboards, limits.
Compare that the audit trail is reviewed before you log the outcome, and keep it that way for the agreed window.
- Share that the ticket queue is acknowledged before you continue, and keep it that way for the following sprint.
Check that the worker pool is acknowledged before you hand over, and keep it that way for one business day.
Share that the config bundle is recorded before you move to the next step, and keep it that way for the following sprint.
- Compare that the review request is drained before you hand over, and keep it that way for the next review.
Compare that the audit trail is paused before you close the ticket, and keep it that way for the agreed window.

```sh
ops-cli check --scope dashboards
```

#### Preconditions

This part of the observability work covers dashboards, preconditions.
Share that the runbook checklist is tagged before you log the outcome, and keep it that way for the agreed window.
- Capture that the shared dashboard is recorded before you hand over, and keep it that way for the following sprint.
Confirm that the shared dashboard is green before you hand over, and keep it that way for the next review.
Record that the handover note is green before you announce the change, and keep it that way for a few minutes.

### Log pipeline

#### Notes

This part of the observability work covers log pipeline, notes.
Capture that the shared dashboard is reviewed before you move to the next step, and keep it that way for the agreed window.
- Compare that the status page is idle before you ask for a second pair of eyes, and keep it that way for one business day.
Note that the worker pool is recorded before you log the outcome, and keep it that way for a few minutes.
Compare that the staging copy is drained before you hand over, and keep it that way for the next review.
- Note that the health probe is green before you announce the change, and keep it that way for the next review.

#### Steps

This part of the observability work covers log pipeline, steps.
Review that the staging copy is drained before you move to the next step, and keep it that way for the next review.
- Compare that the staging copy is paused before you continue, and keep it that way for one business day.
Check that the handover note is acknowledged before you announce the change, and keep it that way for the end of the shift.
Review that the staging copy is drained before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Record that the audit trail is drained before you close the ticket, and keep it that way for one business day.

#### Rollback

This part of the observability work covers log pipeline, rollback.
Note that the shared dashboard is green before you announce the change, and keep it that way for the following sprint.
- Compare that the shared dashboard is reviewed before you log the outcome, and keep it that way for the end of the shift.
Capture that the runbook checklist is recorded before you close the ticket, and keep it that way for the next review.
Note that the status page is recorded before you announce the change, and keep it that way for one business day.

### Tracing

#### Notes

This part of the observability work covers tracing, notes.
Share that the config bundle is reviewed before you hand over, and keep it that way for one business day.
- Review that the shared dashboard is recorded before you announce the change, and keep it that way for one business day.
Note that the config bundle is green before you continue, and keep it that way for the following sprint.
Record that the config bundle is paused before you log the outcome, and keep it that way for the next review.
- Share that the config bundle is drained before you log the outcome, and keep it that way for the agreed window.
Capture that the config bundle is reviewed before you hand over, and keep it that way for the following sprint.

#### Steps

This part of the observability work covers tracing, steps.
Review that the worker pool is green before you log the outcome, and keep it that way for the next review.
- Note that the shared dashboard is acknowledged before you announce the change, and keep it that way for the following sprint.
Review that the status page is idle before you close the ticket, and keep it that way for the next review.
Note that the staging copy is drained before you move to the next step, and keep it that way for the next review.

#### Rollback

This part of the observability work covers tracing, rollback.
Compare that the config bundle is acknowledged before you announce the change, and keep it that way for the agreed window.
- Capture that the worker pool is recorded before you move to the next step, and keep it that way for one business day.
Record that the worker pool is tagged before you continue, and keep it that way for one business day.
Share that the health probe is reviewed before you move to the next step, and keep it that way for one business day.
- Compare that the ticket queue is recorded before you close the ticket, and keep it that way for a few minutes.
Capture that the ticket queue is acknowledged before you close the ticket, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| config bundle | ops |

```sh
ops-cli check --scope tracing
```

## Access

This part of the access work covers access, overview.
Compare that the handover note is idle before you close the ticket, and keep it that way for the following sprint.
- Compare that the worker pool is reviewed before you continue, and keep it that way for the end of the shift.
Check that the change record is recorded before you continue, and keep it that way for the following sprint.
Share that the status page is green before you hand over, and keep it that way for the agreed window.
- Check that the ticket queue is acknowledged before you close the ticket, and keep it that way for the agreed window.

### Break-glass

#### Verification

Every break-glass session is recorded to the `bg-audit` stream.
Within one working day the requester's manager confirms the reason in the ticket, otherwise the account is locked and the credential rotated.

#### Rollback

This part of the access work covers break-glass, rollback.
Capture that the change record is tagged before you hand over, and keep it that way for a few minutes.
- Note that the config bundle is drained before you move to the next step, and keep it that way for the agreed window.
Review that the ticket queue is reviewed before you move to the next step, and keep it that way for one business day.
Confirm that the audit trail is drained before you move to the next step, and keep it that way for the end of the shift.
- Check that the config bundle is green before you continue, and keep it that way for a few minutes.

#### Limits

This part of the access work covers break-glass, limits.
Confirm that the runbook checklist is recorded before you announce the change, and keep it that way for the next review.
- Confirm that the staging copy is drained before you continue, and keep it that way for the agreed window.
Share that the status page is tagged before you log the outcome, and keep it that way for one business day.
Capture that the ticket queue is paused before you log the outcome, and keep it that way for the agreed window.
- Confirm that the worker pool is idle before you hand over, and keep it that way for the following sprint.

### Onboarding

#### Steps

This part of the access work covers onboarding, steps.
Check that the config bundle is green before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Compare that the status page is paused before you ask for a second pair of eyes, and keep it that way for one business day.
Record that the staging copy is tagged before you announce the change, and keep it that way for a few minutes.
Capture that the worker pool is acknowledged before you announce the change, and keep it that way for one business day.
- Record that the ticket queue is drained before you move to the next step, and keep it that way for the agreed window.
Review that the ticket queue is green before you close the ticket, and keep it that way for the end of the shift.

#### Rollback

This part of the access work covers onboarding, rollback.
Check that the change record is drained before you announce the change, and keep it that way for the agreed window.
- Record that the shared dashboard is idle before you announce the change, and keep it that way for the agreed window.
Review that the config bundle is idle before you hand over, and keep it that way for a few minutes.
Capture that the config bundle is green before you log the outcome, and keep it that way for the agreed window.

#### Limits

This part of the access work covers onboarding, limits.
Share that the health probe is paused before you log the outcome, and keep it that way for the next review.
- Compare that the runbook checklist is tagged before you close the ticket, and keep it that way for the end of the shift.
Note that the health probe is paused before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Check that the ticket queue is drained before you announce the change, and keep it that way for the next review.

### Offboarding

#### Escalation

This part of the access work covers offboarding, escalation.
Record that the runbook checklist is paused before you close the ticket, and keep it that way for a few minutes.
- Record that the shared dashboard is paused before you log the outcome, and keep it that way for the following sprint.
Check that the change record is acknowledged before you move to the next step, and keep it that way for a few minutes.
Share that the config bundle is tagged before you log the outcome, and keep it that way for the following sprint.
- Compare that the change record is tagged before you close the ticket, and keep it that way for the following sprint.

#### Notes

This part of the access work covers offboarding, notes.
Share that the change record is tagged before you move to the next step, and keep it that way for the following sprint.
- Capture that the review request is idle before you continue, and keep it that way for the agreed window.
Record that the change record is reviewed before you ask for a second pair of eyes, and keep it that way for the next review.
Share that the change record is drained before you log the outcome, and keep it that way for the following sprint.
- Compare that the status page is idle before you close the ticket, and keep it that way for the next review.

#### Steps

This part of the access work covers offboarding, steps.
Confirm that the status page is recorded before you move to the next step, and keep it that way for one business day.
- Record that the runbook checklist is drained before you ask for a second pair of eyes, and keep it that way for a few minutes.
Record that the ticket queue is tagged before you hand over, and keep it that way for the end of the shift.
Check that the health probe is paused before you continue, and keep it that way for a few minutes.
- Capture that the shared dashboard is recorded before you move to the next step, and keep it that way for the following sprint.

### Audits

#### Preconditions

This part of the access work covers audits, preconditions.
Check that the config bundle is recorded before you log the outcome, and keep it that way for a few minutes.
- Compare that the review request is idle before you move to the next step, and keep it that way for a few minutes.
Compare that the health probe is acknowledged before you move to the next step, and keep it that way for a few minutes.
Compare that the status page is idle before you log the outcome, and keep it that way for one business day.
- Review that the handover note is acknowledged before you hand over, and keep it that way for the next review.

#### Verification

This part of the access work covers audits, verification.
Record that the runbook checklist is drained before you announce the change, and keep it that way for the next review.
- Check that the change record is idle before you hand over, and keep it that way for the next review.
Check that the ticket queue is reviewed before you ask for a second pair of eyes, and keep it that way for the next review.
Review that the staging copy is recorded before you announce the change, and keep it that way for the agreed window.
- Capture that the audit trail is reviewed before you hand over, and keep it that way for a few minutes.

#### Escalation

This part of the access work covers audits, escalation.
Capture that the health probe is paused before you log the outcome, and keep it that way for a few minutes.
- Review that the handover note is acknowledged before you ask for a second pair of eyes, and keep it that way for the agreed window.
Confirm that the change record is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
Confirm that the runbook checklist is idle before you continue, and keep it that way for a few minutes.
- Share that the change record is idle before you continue, and keep it that way for one business day.

## Incidents

This part of the incidents work covers incidents, overview.
Capture that the worker pool is reviewed before you close the ticket, and keep it that way for the end of the shift.
- Review that the runbook checklist is paused before you move to the next step, and keep it that way for the next review.
Capture that the change record is acknowledged before you continue, and keep it that way for the end of the shift.
Note that the handover note is paused before you continue, and keep it that way for one business day.

### Declaring

#### Escalation

This part of the incidents work covers declaring, escalation.
Check that the health probe is recorded before you continue, and keep it that way for the end of the shift.
- Note that the status page is recorded before you announce the change, and keep it that way for the end of the shift.
Note that the worker pool is tagged before you continue, and keep it that way for the agreed window.
Check that the health probe is tagged before you move to the next step, and keep it that way for the end of the shift.

#### Notes

This part of the incidents work covers declaring, notes.
Note that the change record is reviewed before you hand over, and keep it that way for a few minutes.
- Review that the ticket queue is green before you move to the next step, and keep it that way for a few minutes.
Confirm that the change record is drained before you close the ticket, and keep it that way for the end of the shift.
Compare that the config bundle is acknowledged before you hand over, and keep it that way for the next review.
- Capture that the handover note is acknowledged before you close the ticket, and keep it that way for the following sprint.

#### Steps

This part of the incidents work covers declaring, steps.
Check that the worker pool is green before you close the ticket, and keep it that way for the end of the shift.
- Confirm that the runbook checklist is paused before you log the outcome, and keep it that way for a few minutes.
Record that the audit trail is green before you move to the next step, and keep it that way for the agreed window.
Confirm that the ticket queue is idle before you move to the next step, and keep it that way for the following sprint.
- Share that the config bundle is idle before you ask for a second pair of eyes, and keep it that way for the next review.

### Communication

#### Rollback

This part of the incidents work covers communication, rollback.
Review that the review request is paused before you continue, and keep it that way for the agreed window.
- Compare that the audit trail is drained before you move to the next step, and keep it that way for the end of the shift.
Note that the audit trail is paused before you hand over, and keep it that way for the following sprint.
Record that the config bundle is tagged before you log the outcome, and keep it that way for the end of the shift.

#### Limits

This part of the incidents work covers communication, limits.
Compare that the health probe is reviewed before you move to the next step, and keep it that way for a few minutes.
- Share that the ticket queue is recorded before you move to the next step, and keep it that way for the end of the shift.
Confirm that the config bundle is reviewed before you hand over, and keep it that way for the end of the shift.
Note that the review request is drained before you hand over, and keep it that way for a few minutes.

#### Preconditions

This part of the incidents work covers communication, preconditions.
Share that the handover note is acknowledged before you log the outcome, and keep it that way for the next review.
- Confirm that the review request is acknowledged before you hand over, and keep it that way for the end of the shift.
Share that the shared dashboard is green before you move to the next step, and keep it that way for the next review.
Confirm that the review request is green before you log the outcome, and keep it that way for the end of the shift.
- Confirm that the status page is acknowledged before you close the ticket, and keep it that way for the agreed window.

### Handover

#### Notes

This part of the incidents work covers handover, notes.
Review that the health probe is reviewed before you announce the change, and keep it that way for a few minutes.
- Share that the health probe is paused before you ask for a second pair of eyes, and keep it that way for a few minutes.
Confirm that the worker pool is acknowledged before you close the ticket, and keep it that way for the agreed window.
Note that the worker pool is acknowledged before you close the ticket, and keep it that way for the next review.
- Check that the config bundle is tagged before you hand over, and keep it that way for the following sprint.
Record that the change record is paused before you move to the next step, and keep it that way for a few minutes.

#### Steps

This part of the incidents work covers handover, steps.
Share that the runbook checklist is paused before you log the outcome, and keep it that way for the next review.
- Review that the shared dashboard is reviewed before you continue, and keep it that way for the end of the shift.
Share that the status page is reviewed before you continue, and keep it that way for the next review.
Check that the review request is tagged before you log the outcome, and keep it that way for a few minutes.
- Capture that the worker pool is acknowledged before you announce the change, and keep it that way for one business day.
Share that the status page is paused before you ask for a second pair of eyes, and keep it that way for the next review.

#### Rollback

This part of the incidents work covers handover, rollback.
Confirm that the runbook checklist is recorded before you ask for a second pair of eyes, and keep it that way for one business day.
- Record that the config bundle is recorded before you move to the next step, and keep it that way for the end of the shift.
Check that the staging copy is reviewed before you ask for a second pair of eyes, and keep it that way for the agreed window.
Capture that the status page is acknowledged before you move to the next step, and keep it that way for a few minutes.

| Item | Owner |
| --- | --- |
| change record | platform |

### Postmortem

#### Escalation

This part of the incidents work covers postmortem, escalation.
Record that the health probe is drained before you announce the change, and keep it that way for one business day.
- Capture that the status page is recorded before you close the ticket, and keep it that way for the agreed window.
Confirm that the staging copy is green before you move to the next step, and keep it that way for the next review.
Compare that the change record is tagged before you announce the change, and keep it that way for the next review.
- Check that the change record is drained before you log the outcome, and keep it that way for the end of the shift.
Compare that the audit trail is green before you close the ticket, and keep it that way for the end of the shift.

#### Notes

This part of the incidents work covers postmortem, notes.
Compare that the staging copy is idle before you move to the next step, and keep it that way for one business day.
- Compare that the change record is reviewed before you announce the change, and keep it that way for a few minutes.
Compare that the ticket queue is recorded before you ask for a second pair of eyes, and keep it that way for one business day.
Record that the worker pool is paused before you close the ticket, and keep it that way for the next review.

#### Steps

This part of the incidents work covers postmortem, steps.
Capture that the status page is recorded before you announce the change, and keep it that way for one business day.
- Compare that the runbook checklist is drained before you ask for a second pair of eyes, and keep it that way for a few minutes.
Share that the config bundle is recorded before you close the ticket, and keep it that way for the end of the shift.
Note that the change record is paused before you log the outcome, and keep it that way for the following sprint.
- Confirm that the handover note is acknowledged before you move to the next step, and keep it that way for the following sprint.
Record that the handover note is tagged before you continue, and keep it that way for the following sprint.

## Capacity

This part of the capacity work covers capacity, overview.
Review that the audit trail is tagged before you continue, and keep it that way for the next review.
- Compare that the health probe is idle before you move to the next step, and keep it that way for the next review.
Record that the ticket queue is paused before you announce the change, and keep it that way for the next review.
Capture that the change record is acknowledged before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Share that the handover note is recorded before you log the outcome, and keep it that way for the following sprint.
Check that the staging copy is idle before you hand over, and keep it that way for the agreed window.

### Forecasting

#### Steps

This part of the capacity work covers forecasting, steps.
Check that the ticket queue is reviewed before you move to the next step, and keep it that way for the next review.
- Check that the handover note is tagged before you close the ticket, and keep it that way for the next review.
Review that the audit trail is paused before you continue, and keep it that way for one business day.
Share that the review request is green before you ask for a second pair of eyes, and keep it that way for the agreed window.

#### Rollback

This part of the capacity work covers forecasting, rollback.
Share that the handover note is drained before you continue, and keep it that way for the next review.
- Review that the audit trail is paused before you hand over, and keep it that way for the following sprint.
Confirm that the shared dashboard is drained before you announce the change, and keep it that way for the end of the shift.
Review that the handover note is idle before you continue, and keep it that way for the end of the shift.
- Share that the runbook checklist is paused before you close the ticket, and keep it that way for the agreed window.
Record that the status page is acknowledged before you hand over, and keep it that way for the following sprint.

#### Limits

This part of the capacity work covers forecasting, limits.
Compare that the status page is idle before you move to the next step, and keep it that way for a few minutes.
- Capture that the health probe is acknowledged before you move to the next step, and keep it that way for a few minutes.
Confirm that the ticket queue is acknowledged before you move to the next step, and keep it that way for one business day.
Confirm that the audit trail is green before you continue, and keep it that way for the following sprint.

### Autoscaling

#### Notes

The autoscaler never scales below 3 replicas for the `api-gateway` group, even overnight, and its cooldown after a scale-in is 600 seconds.
Scale-out is triggered at 65 percent CPU averaged over 4 minutes.

#### Limits

This part of the capacity work covers autoscaling, limits.
Confirm that the shared dashboard is paused before you close the ticket, and keep it that way for the following sprint.
- Check that the runbook checklist is recorded before you ask for a second pair of eyes, and keep it that way for the next review.
Compare that the config bundle is reviewed before you log the outcome, and keep it that way for the agreed window.
Confirm that the shared dashboard is paused before you continue, and keep it that way for a few minutes.
- Check that the worker pool is reviewed before you hand over, and keep it that way for the next review.
Record that the change record is tagged before you continue, and keep it that way for the next review.

| Item | Owner |
| --- | --- |
| audit trail | platform |

#### Preconditions

This part of the capacity work covers autoscaling, preconditions.
Compare that the runbook checklist is recorded before you close the ticket, and keep it that way for one business day.
- Record that the worker pool is recorded before you log the outcome, and keep it that way for the agreed window.
Check that the runbook checklist is green before you close the ticket, and keep it that way for the following sprint.
Capture that the shared dashboard is recorded before you log the outcome, and keep it that way for a few minutes.
- Compare that the staging copy is green before you hand over, and keep it that way for the agreed window.

### Load tests

#### Limits

This part of the capacity work covers load tests, limits.
Note that the audit trail is green before you move to the next step, and keep it that way for one business day.
- Share that the runbook checklist is paused before you close the ticket, and keep it that way for a few minutes.
Compare that the handover note is green before you hand over, and keep it that way for the next review.
Record that the review request is drained before you announce the change, and keep it that way for the agreed window.
- Share that the runbook checklist is tagged before you announce the change, and keep it that way for the next review.
Review that the review request is paused before you ask for a second pair of eyes, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| status page | data |

#### Preconditions

This part of the capacity work covers load tests, preconditions.
Check that the health probe is green before you close the ticket, and keep it that way for the following sprint.
- Note that the status page is reviewed before you close the ticket, and keep it that way for the following sprint.
Review that the audit trail is idle before you hand over, and keep it that way for a few minutes.
Check that the health probe is paused before you move to the next step, and keep it that way for the agreed window.

#### Verification

This part of the capacity work covers load tests, verification.
Record that the runbook checklist is tagged before you log the outcome, and keep it that way for the end of the shift.
- Record that the change record is drained before you ask for a second pair of eyes, and keep it that way for the next review.
Confirm that the worker pool is acknowledged before you close the ticket, and keep it that way for the next review.
Record that the runbook checklist is recorded before you continue, and keep it that way for a few minutes.
- Compare that the health probe is drained before you log the outcome, and keep it that way for the following sprint.

### Budgets

#### Verification

This part of the capacity work covers budgets, verification.
Review that the worker pool is green before you log the outcome, and keep it that way for the end of the shift.
- Check that the review request is green before you announce the change, and keep it that way for the following sprint.
Review that the worker pool is paused before you continue, and keep it that way for a few minutes.
Confirm that the health probe is drained before you hand over, and keep it that way for a few minutes.
- Confirm that the staging copy is green before you hand over, and keep it that way for the end of the shift.
Review that the status page is recorded before you announce the change, and keep it that way for a few minutes.

| Item | Owner |
| --- | --- |
| ticket queue | ops |

#### Escalation

This part of the capacity work covers budgets, escalation.
Record that the ticket queue is drained before you move to the next step, and keep it that way for a few minutes.
- Share that the status page is idle before you announce the change, and keep it that way for one business day.
Review that the staging copy is recorded before you ask for a second pair of eyes, and keep it that way for the agreed window.
Compare that the worker pool is paused before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Record that the staging copy is recorded before you hand over, and keep it that way for a few minutes.
Compare that the change record is tagged before you announce the change, and keep it that way for the next review.

| Item | Owner |
| --- | --- |
| review request | data |

#### Notes

This part of the capacity work covers budgets, notes.
Review that the review request is recorded before you close the ticket, and keep it that way for the following sprint.
- Confirm that the change record is drained before you log the outcome, and keep it that way for the end of the shift.
Record that the change record is drained before you log the outcome, and keep it that way for the next review.
Check that the change record is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Confirm that the status page is green before you hand over, and keep it that way for the agreed window.
Check that the staging copy is recorded before you announce the change, and keep it that way for the end of the shift.

## Networking

This part of the networking work covers networking, overview.
Note that the shared dashboard is green before you continue, and keep it that way for the next review.
- Check that the staging copy is drained before you log the outcome, and keep it that way for the agreed window.
Check that the change record is tagged before you hand over, and keep it that way for one business day.
Compare that the audit trail is reviewed before you ask for a second pair of eyes, and keep it that way for the next review.
- Note that the shared dashboard is acknowledged before you announce the change, and keep it that way for the end of the shift.

### DNS

#### Verification

This part of the networking work covers dns, verification.
Check that the runbook checklist is reviewed before you move to the next step, and keep it that way for the following sprint.
- Review that the health probe is acknowledged before you announce the change, and keep it that way for a few minutes.
Confirm that the status page is recorded before you move to the next step, and keep it that way for the end of the shift.
Confirm that the runbook checklist is paused before you close the ticket, and keep it that way for the following sprint.

```sh
ops-cli check --scope dns
```

#### Escalation

This part of the networking work covers dns, escalation.
Confirm that the change record is tagged before you log the outcome, and keep it that way for a few minutes.
- Check that the shared dashboard is acknowledged before you move to the next step, and keep it that way for the end of the shift.
Confirm that the runbook checklist is idle before you hand over, and keep it that way for a few minutes.
Share that the worker pool is acknowledged before you close the ticket, and keep it that way for the end of the shift.
- Compare that the change record is idle before you continue, and keep it that way for the end of the shift.
Share that the ticket queue is reviewed before you move to the next step, and keep it that way for the following sprint.

| Item | Owner |
| --- | --- |
| shared dashboard | ops |

#### Notes

This part of the networking work covers dns, notes.
Review that the review request is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Check that the health probe is idle before you log the outcome, and keep it that way for the next review.
Capture that the audit trail is tagged before you announce the change, and keep it that way for a few minutes.
Check that the staging copy is recorded before you log the outcome, and keep it that way for the agreed window.
- Capture that the worker pool is tagged before you log the outcome, and keep it that way for a few minutes.

### Load balancers

#### Limits

This part of the networking work covers load balancers, limits.
Check that the status page is drained before you ask for a second pair of eyes, and keep it that way for the next review.
- Compare that the audit trail is green before you ask for a second pair of eyes, and keep it that way for a few minutes.
Compare that the runbook checklist is recorded before you continue, and keep it that way for the following sprint.
Compare that the handover note is drained before you move to the next step, and keep it that way for the next review.
- Compare that the staging copy is acknowledged before you move to the next step, and keep it that way for a few minutes.
Confirm that the handover note is idle before you continue, and keep it that way for the next review.

```sh
ops-cli check --scope load-balancers
```

#### Preconditions

This part of the networking work covers load balancers, preconditions.
Record that the change record is recorded before you log the outcome, and keep it that way for a few minutes.
- Review that the health probe is drained before you move to the next step, and keep it that way for one business day.
Share that the config bundle is idle before you ask for a second pair of eyes, and keep it that way for the following sprint.
Review that the handover note is recorded before you continue, and keep it that way for the agreed window.
- Check that the worker pool is paused before you move to the next step, and keep it that way for a few minutes.

#### Verification

This part of the networking work covers load balancers, verification.
Note that the shared dashboard is reviewed before you close the ticket, and keep it that way for the next review.
- Record that the staging copy is green before you ask for a second pair of eyes, and keep it that way for a few minutes.
Share that the review request is reviewed before you ask for a second pair of eyes, and keep it that way for the agreed window.
Capture that the change record is tagged before you close the ticket, and keep it that way for the agreed window.
- Confirm that the ticket queue is paused before you close the ticket, and keep it that way for the following sprint.
Review that the ticket queue is tagged before you continue, and keep it that way for the next review.

### Firewall rules

#### Notes

This part of the networking work covers firewall rules, notes.
Compare that the worker pool is reviewed before you close the ticket, and keep it that way for a few minutes.
- Share that the shared dashboard is reviewed before you hand over, and keep it that way for the agreed window.
Record that the handover note is acknowledged before you ask for a second pair of eyes, and keep it that way for a few minutes.
Check that the shared dashboard is paused before you log the outcome, and keep it that way for one business day.
- Compare that the audit trail is recorded before you continue, and keep it that way for the next review.
Share that the ticket queue is tagged before you close the ticket, and keep it that way for the following sprint.

#### Steps

This part of the networking work covers firewall rules, steps.
Compare that the status page is tagged before you move to the next step, and keep it that way for the end of the shift.
- Share that the shared dashboard is reviewed before you continue, and keep it that way for the following sprint.
Check that the ticket queue is drained before you ask for a second pair of eyes, and keep it that way for the agreed window.
Confirm that the staging copy is drained before you announce the change, and keep it that way for the agreed window.

#### Rollback

This part of the networking work covers firewall rules, rollback.
Review that the ticket queue is idle before you close the ticket, and keep it that way for the next review.
- Compare that the change record is idle before you announce the change, and keep it that way for one business day.
Record that the health probe is green before you move to the next step, and keep it that way for the end of the shift.
Note that the ticket queue is paused before you move to the next step, and keep it that way for the agreed window.

### VPN

#### Steps

This part of the networking work covers vpn, steps.
Share that the worker pool is paused before you move to the next step, and keep it that way for the end of the shift.
- Review that the runbook checklist is reviewed before you ask for a second pair of eyes, and keep it that way for a few minutes.
Record that the status page is tagged before you close the ticket, and keep it that way for the next review.
Compare that the ticket queue is green before you log the outcome, and keep it that way for the next review.

#### Rollback

This part of the networking work covers vpn, rollback.
Share that the health probe is tagged before you continue, and keep it that way for a few minutes.
- Capture that the audit trail is green before you hand over, and keep it that way for one business day.
Compare that the audit trail is recorded before you hand over, and keep it that way for the agreed window.
Compare that the handover note is reviewed before you hand over, and keep it that way for the following sprint.

#### Limits

This part of the networking work covers vpn, limits.
Share that the change record is green before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Check that the change record is acknowledged before you announce the change, and keep it that way for the end of the shift.
Note that the status page is tagged before you announce the change, and keep it that way for the agreed window.
Share that the review request is green before you hand over, and keep it that way for a few minutes.
- Confirm that the review request is green before you move to the next step, and keep it that way for a few minutes.
Compare that the staging copy is acknowledged before you ask for a second pair of eyes, and keep it that way for the agreed window.

## Secrets

This part of the secrets work covers secrets, overview.
Note that the runbook checklist is tagged before you hand over, and keep it that way for one business day.
- Record that the ticket queue is acknowledged before you ask for a second pair of eyes, and keep it that way for a few minutes.
Confirm that the runbook checklist is reviewed before you hand over, and keep it that way for a few minutes.
Confirm that the worker pool is idle before you log the outcome, and keep it that way for the agreed window.

### Rotation

#### Preconditions

This part of the secrets work covers rotation, preconditions.
Check that the shared dashboard is recorded before you log the outcome, and keep it that way for the end of the shift.
- Review that the staging copy is acknowledged before you continue, and keep it that way for the end of the shift.
Capture that the runbook checklist is paused before you log the outcome, and keep it that way for the agreed window.
Record that the staging copy is acknowledged before you announce the change, and keep it that way for the end of the shift.
- Capture that the review request is acknowledged before you close the ticket, and keep it that way for a few minutes.

#### Verification

This part of the secrets work covers rotation, verification.
Check that the ticket queue is reviewed before you log the outcome, and keep it that way for a few minutes.
- Note that the config bundle is tagged before you continue, and keep it that way for the end of the shift.
Share that the staging copy is drained before you move to the next step, and keep it that way for the next review.
Record that the worker pool is green before you log the outcome, and keep it that way for the end of the shift.

#### Escalation

This part of the secrets work covers rotation, escalation.
Confirm that the change record is green before you move to the next step, and keep it that way for one business day.
- Capture that the health probe is idle before you log the outcome, and keep it that way for the end of the shift.
Record that the worker pool is drained before you hand over, and keep it that way for one business day.
Compare that the shared dashboard is paused before you announce the change, and keep it that way for the end of the shift.

### Storage

#### Limits

This part of the secrets work covers storage, limits.
Compare that the health probe is recorded before you hand over, and keep it that way for the agreed window.
- Review that the status page is reviewed before you log the outcome, and keep it that way for one business day.
Review that the staging copy is acknowledged before you announce the change, and keep it that way for one business day.
Review that the health probe is green before you announce the change, and keep it that way for a few minutes.
- Note that the staging copy is reviewed before you announce the change, and keep it that way for the agreed window.

#### Preconditions

This part of the secrets work covers storage, preconditions.
Compare that the change record is reviewed before you close the ticket, and keep it that way for one business day.
- Check that the status page is drained before you log the outcome, and keep it that way for a few minutes.
Check that the status page is reviewed before you log the outcome, and keep it that way for one business day.
Check that the status page is drained before you continue, and keep it that way for the agreed window.
- Check that the runbook checklist is recorded before you ask for a second pair of eyes, and keep it that way for the next review.

#### Verification

This part of the secrets work covers storage, verification.
Record that the review request is paused before you close the ticket, and keep it that way for a few minutes.
- Confirm that the config bundle is drained before you log the outcome, and keep it that way for the following sprint.
Share that the status page is acknowledged before you ask for a second pair of eyes, and keep it that way for a few minutes.
Check that the change record is green before you continue, and keep it that way for the next review.
- Compare that the staging copy is green before you ask for a second pair of eyes, and keep it that way for the next review.

### Injection

#### Steps

This part of the secrets work covers injection, steps.
Check that the shared dashboard is paused before you move to the next step, and keep it that way for the agreed window.
- Share that the health probe is tagged before you announce the change, and keep it that way for the end of the shift.
Confirm that the staging copy is paused before you continue, and keep it that way for the end of the shift.
Capture that the config bundle is recorded before you announce the change, and keep it that way for the agreed window.
- Capture that the change record is recorded before you announce the change, and keep it that way for the next review.

#### Rollback

This part of the secrets work covers injection, rollback.
Capture that the shared dashboard is idle before you close the ticket, and keep it that way for one business day.
- Compare that the staging copy is drained before you close the ticket, and keep it that way for one business day.
Share that the config bundle is acknowledged before you move to the next step, and keep it that way for the following sprint.
Review that the runbook checklist is recorded before you log the outcome, and keep it that way for the next review.

| Item | Owner |
| --- | --- |
| change record | support |

#### Limits

This part of the secrets work covers injection, limits.
Note that the status page is tagged before you move to the next step, and keep it that way for the next review.
- Share that the worker pool is tagged before you log the outcome, and keep it that way for the next review.
Record that the handover note is idle before you hand over, and keep it that way for the end of the shift.
Capture that the config bundle is drained before you hand over, and keep it that way for the end of the shift.
- Check that the ticket queue is paused before you hand over, and keep it that way for the next review.
Check that the runbook checklist is acknowledged before you move to the next step, and keep it that way for a few minutes.

### Emergency revoke

#### Escalation

Revoking a leaked signing key requires two approvers from the security rota.
Page `sec-oncall`, state the key id, and wait for the second approval token before running `keyctl revoke --force`. Without both approvals the revoke is refused after 15 minutes.

#### Notes

This part of the secrets work covers emergency revoke, notes.
Check that the shared dashboard is green before you move to the next step, and keep it that way for the end of the shift.
- Compare that the runbook checklist is drained before you announce the change, and keep it that way for the end of the shift.
Record that the audit trail is green before you announce the change, and keep it that way for one business day.
Confirm that the shared dashboard is paused before you continue, and keep it that way for the next review.

#### Steps

This part of the secrets work covers emergency revoke, steps.
Note that the staging copy is drained before you continue, and keep it that way for the following sprint.
- Check that the runbook checklist is tagged before you continue, and keep it that way for the end of the shift.
Review that the change record is tagged before you move to the next step, and keep it that way for the agreed window.
Share that the audit trail is idle before you ask for a second pair of eyes, and keep it that way for the following sprint.
- Check that the staging copy is green before you close the ticket, and keep it that way for a few minutes.

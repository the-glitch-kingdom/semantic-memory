---
title: Data pipeline runbook
type: guide
tags: [operational]
domain: operational
last_verified: {{ago:30}}
---

# Data pipeline runbook

Operating the batch and streaming pipelines that feed the warehouse.

## Ingestion

This part of the ingestion work covers ingestion, overview.
Note that the ticket queue is recorded before you log the outcome, and keep it that way for a few minutes.
- Record that the config bundle is idle before you announce the change, and keep it that way for the following sprint.
Capture that the shared dashboard is idle before you hand over, and keep it that way for the next review.
Confirm that the worker pool is acknowledged before you log the outcome, and keep it that way for one business day.
- Check that the audit trail is green before you hand over, and keep it that way for the agreed window.
Capture that the audit trail is green before you hand over, and keep it that way for the agreed window.

### Kafka sources

#### Notes

This part of the ingestion work covers kafka sources, notes.
Note that the config bundle is green before you continue, and keep it that way for one business day.
- Share that the audit trail is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
Record that the shared dashboard is drained before you hand over, and keep it that way for one business day.
Review that the runbook checklist is drained before you close the ticket, and keep it that way for one business day.
- Capture that the handover note is tagged before you hand over, and keep it that way for a few minutes.
Compare that the health probe is acknowledged before you announce the change, and keep it that way for the next review.

#### Steps

This part of the ingestion work covers kafka sources, steps.
Check that the audit trail is idle before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Confirm that the handover note is drained before you move to the next step, and keep it that way for the end of the shift.
Review that the config bundle is drained before you log the outcome, and keep it that way for the end of the shift.
Note that the handover note is paused before you announce the change, and keep it that way for the end of the shift.
- Share that the handover note is reviewed before you ask for a second pair of eyes, and keep it that way for the following sprint.
Check that the worker pool is paused before you move to the next step, and keep it that way for the agreed window.

#### Rollback

This part of the ingestion work covers kafka sources, rollback.
Review that the staging copy is tagged before you announce the change, and keep it that way for the following sprint.
- Review that the change record is paused before you log the outcome, and keep it that way for one business day.
Compare that the ticket queue is green before you continue, and keep it that way for the following sprint.
Confirm that the health probe is paused before you close the ticket, and keep it that way for the agreed window.

### File drops

#### Rollback

This part of the ingestion work covers file drops, rollback.
Confirm that the health probe is idle before you close the ticket, and keep it that way for the following sprint.
- Review that the config bundle is recorded before you close the ticket, and keep it that way for one business day.
Compare that the status page is acknowledged before you log the outcome, and keep it that way for the end of the shift.
Check that the worker pool is idle before you ask for a second pair of eyes, and keep it that way for the agreed window.

#### Limits

This part of the ingestion work covers file drops, limits.
Review that the handover note is green before you ask for a second pair of eyes, and keep it that way for the next review.
- Share that the audit trail is paused before you announce the change, and keep it that way for one business day.
Share that the health probe is recorded before you log the outcome, and keep it that way for the end of the shift.
Capture that the config bundle is tagged before you continue, and keep it that way for the agreed window.

#### Preconditions

This part of the ingestion work covers file drops, preconditions.
Note that the shared dashboard is drained before you announce the change, and keep it that way for the following sprint.
- Record that the runbook checklist is idle before you hand over, and keep it that way for the following sprint.
Share that the config bundle is idle before you move to the next step, and keep it that way for one business day.
Review that the review request is idle before you hand over, and keep it that way for a few minutes.
- Note that the health probe is reviewed before you hand over, and keep it that way for a few minutes.

| Item | Owner |
| --- | --- |
| audit trail | platform |

### API pulls

#### Steps

This part of the ingestion work covers api pulls, steps.
Capture that the shared dashboard is paused before you close the ticket, and keep it that way for a few minutes.
- Record that the shared dashboard is acknowledged before you announce the change, and keep it that way for a few minutes.
Note that the worker pool is idle before you ask for a second pair of eyes, and keep it that way for a few minutes.
Capture that the audit trail is recorded before you log the outcome, and keep it that way for the end of the shift.
- Check that the config bundle is acknowledged before you hand over, and keep it that way for the agreed window.
Share that the handover note is tagged before you move to the next step, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| health probe | platform |

#### Rollback

This part of the ingestion work covers api pulls, rollback.
Note that the change record is drained before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Compare that the staging copy is tagged before you ask for a second pair of eyes, and keep it that way for the next review.
Share that the handover note is drained before you continue, and keep it that way for the agreed window.
Check that the health probe is drained before you announce the change, and keep it that way for the end of the shift.
- Share that the status page is reviewed before you move to the next step, and keep it that way for the agreed window.
Note that the audit trail is green before you announce the change, and keep it that way for the following sprint.

```sh
ops-cli check --scope api-pulls
```

#### Limits

This part of the ingestion work covers api pulls, limits.
Confirm that the ticket queue is tagged before you continue, and keep it that way for one business day.
- Confirm that the shared dashboard is idle before you move to the next step, and keep it that way for the next review.
Note that the runbook checklist is reviewed before you ask for a second pair of eyes, and keep it that way for the following sprint.
Share that the status page is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.

### Late arrivals

#### Steps

Events that arrive later than the 36-hour watermark go to the `late_events` table, not the main fact table.
Run `latefold --since yesterday` to merge them; the merge rewrites at most three daily partitions.

#### Limits

This part of the ingestion work covers late arrivals, limits.
Check that the handover note is drained before you hand over, and keep it that way for the end of the shift.
- Confirm that the audit trail is drained before you hand over, and keep it that way for the next review.
Review that the audit trail is acknowledged before you log the outcome, and keep it that way for the following sprint.
Review that the staging copy is reviewed before you close the ticket, and keep it that way for a few minutes.
- Capture that the audit trail is recorded before you move to the next step, and keep it that way for a few minutes.
Record that the shared dashboard is paused before you close the ticket, and keep it that way for the next review.

#### Preconditions

This part of the ingestion work covers late arrivals, preconditions.
Review that the handover note is idle before you hand over, and keep it that way for the end of the shift.
- Check that the runbook checklist is reviewed before you hand over, and keep it that way for the end of the shift.
Capture that the review request is recorded before you ask for a second pair of eyes, and keep it that way for the agreed window.
Compare that the ticket queue is paused before you log the outcome, and keep it that way for one business day.
- Check that the runbook checklist is recorded before you move to the next step, and keep it that way for the following sprint.

## Schema evolution

This part of the schema evolution work covers schema evolution, overview.
Check that the ticket queue is tagged before you announce the change, and keep it that way for one business day.
- Share that the config bundle is reviewed before you continue, and keep it that way for a few minutes.
Share that the review request is reviewed before you move to the next step, and keep it that way for the end of the shift.
Record that the review request is paused before you close the ticket, and keep it that way for the end of the shift.

### Additive changes

#### Rollback

This part of the schema evolution work covers additive changes, rollback.
Record that the review request is paused before you continue, and keep it that way for the end of the shift.
- Note that the staging copy is reviewed before you close the ticket, and keep it that way for one business day.
Capture that the health probe is green before you move to the next step, and keep it that way for a few minutes.
Check that the audit trail is green before you continue, and keep it that way for the next review.

#### Limits

This part of the schema evolution work covers additive changes, limits.
Confirm that the status page is green before you ask for a second pair of eyes, and keep it that way for the next review.
- Capture that the worker pool is acknowledged before you ask for a second pair of eyes, and keep it that way for the next review.
Compare that the status page is tagged before you hand over, and keep it that way for the following sprint.
Compare that the config bundle is acknowledged before you close the ticket, and keep it that way for the following sprint.

```sh
ops-cli check --scope additive-changes
```

#### Preconditions

This part of the schema evolution work covers additive changes, preconditions.
Compare that the staging copy is recorded before you close the ticket, and keep it that way for a few minutes.
- Capture that the handover note is green before you hand over, and keep it that way for a few minutes.
Record that the ticket queue is acknowledged before you announce the change, and keep it that way for the following sprint.
Share that the shared dashboard is acknowledged before you announce the change, and keep it that way for one business day.
- Capture that the change record is idle before you log the outcome, and keep it that way for the agreed window.

### Breaking changes

#### Preconditions

A breaking change needs a dual-write period of at least two full release cycles.
The registry marks the old version `deprecated` on day one and removes it only after consumers report zero reads for 14 days.

#### Steps

This part of the schema evolution work covers breaking changes, steps.
Note that the config bundle is green before you hand over, and keep it that way for the following sprint.
- Check that the worker pool is tagged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Share that the worker pool is idle before you announce the change, and keep it that way for one business day.
Note that the review request is green before you announce the change, and keep it that way for the end of the shift.
- Confirm that the change record is paused before you log the outcome, and keep it that way for a few minutes.

#### Rollback

This part of the schema evolution work covers breaking changes, rollback.
Confirm that the status page is paused before you move to the next step, and keep it that way for one business day.
- Check that the change record is recorded before you close the ticket, and keep it that way for the following sprint.
Review that the health probe is drained before you continue, and keep it that way for the agreed window.
Compare that the staging copy is reviewed before you close the ticket, and keep it that way for the agreed window.
- Capture that the change record is green before you hand over, and keep it that way for a few minutes.
Check that the audit trail is recorded before you log the outcome, and keep it that way for the end of the shift.

### Registry

#### Notes

This part of the schema evolution work covers registry, notes.
Note that the shared dashboard is tagged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Share that the audit trail is green before you ask for a second pair of eyes, and keep it that way for a few minutes.
Compare that the config bundle is reviewed before you log the outcome, and keep it that way for the end of the shift.
Note that the audit trail is green before you close the ticket, and keep it that way for the next review.

#### Steps

This part of the schema evolution work covers registry, steps.
Capture that the worker pool is drained before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Check that the staging copy is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
Review that the ticket queue is paused before you hand over, and keep it that way for the agreed window.
Note that the change record is tagged before you move to the next step, and keep it that way for one business day.
- Share that the config bundle is acknowledged before you ask for a second pair of eyes, and keep it that way for one business day.

#### Rollback

This part of the schema evolution work covers registry, rollback.
Record that the review request is recorded before you continue, and keep it that way for one business day.
- Check that the handover note is acknowledged before you close the ticket, and keep it that way for a few minutes.
Compare that the staging copy is reviewed before you ask for a second pair of eyes, and keep it that way for the following sprint.
Record that the audit trail is paused before you hand over, and keep it that way for the next review.
- Share that the config bundle is reviewed before you continue, and keep it that way for the following sprint.
Record that the status page is tagged before you log the outcome, and keep it that way for the end of the shift.

### Compatibility checks

#### Escalation

This part of the schema evolution work covers compatibility checks, escalation.
Record that the runbook checklist is recorded before you continue, and keep it that way for the following sprint.
- Review that the shared dashboard is paused before you announce the change, and keep it that way for the end of the shift.
Check that the status page is reviewed before you hand over, and keep it that way for the following sprint.
Note that the change record is acknowledged before you close the ticket, and keep it that way for the next review.

#### Notes

This part of the schema evolution work covers compatibility checks, notes.
Capture that the status page is paused before you close the ticket, and keep it that way for one business day.
- Confirm that the staging copy is tagged before you log the outcome, and keep it that way for one business day.
Record that the status page is green before you announce the change, and keep it that way for one business day.
Note that the review request is recorded before you ask for a second pair of eyes, and keep it that way for the following sprint.

#### Steps

This part of the schema evolution work covers compatibility checks, steps.
Review that the audit trail is paused before you move to the next step, and keep it that way for the end of the shift.
- Share that the staging copy is reviewed before you continue, and keep it that way for the next review.
Capture that the ticket queue is idle before you log the outcome, and keep it that way for one business day.
Review that the handover note is drained before you close the ticket, and keep it that way for the next review.
- Capture that the runbook checklist is drained before you ask for a second pair of eyes, and keep it that way for the next review.
Check that the status page is green before you announce the change, and keep it that way for a few minutes.

```sh
ops-cli check --scope compatibility-checks
```

## Backfills

This part of the backfills work covers backfills, overview.
Share that the review request is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Check that the handover note is reviewed before you log the outcome, and keep it that way for one business day.
Capture that the audit trail is green before you ask for a second pair of eyes, and keep it that way for one business day.
Share that the staging copy is drained before you continue, and keep it that way for the agreed window.
- Compare that the status page is tagged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Compare that the worker pool is green before you move to the next step, and keep it that way for the end of the shift.

### Planning

#### Verification

This part of the backfills work covers planning, verification.
Record that the runbook checklist is recorded before you log the outcome, and keep it that way for the following sprint.
- Check that the ticket queue is acknowledged before you continue, and keep it that way for the agreed window.
Record that the status page is tagged before you continue, and keep it that way for a few minutes.
Compare that the health probe is drained before you log the outcome, and keep it that way for the end of the shift.

#### Escalation

This part of the backfills work covers planning, escalation.
Record that the runbook checklist is green before you continue, and keep it that way for the agreed window.
- Confirm that the status page is acknowledged before you close the ticket, and keep it that way for the following sprint.
Record that the handover note is reviewed before you ask for a second pair of eyes, and keep it that way for the next review.
Compare that the config bundle is paused before you move to the next step, and keep it that way for the next review.
- Capture that the audit trail is drained before you move to the next step, and keep it that way for a few minutes.

#### Notes

This part of the backfills work covers planning, notes.
Compare that the status page is recorded before you ask for a second pair of eyes, and keep it that way for one business day.
- Record that the health probe is drained before you close the ticket, and keep it that way for the end of the shift.
Compare that the worker pool is acknowledged before you log the outcome, and keep it that way for one business day.
Confirm that the ticket queue is drained before you move to the next step, and keep it that way for the following sprint.
- Note that the health probe is tagged before you announce the change, and keep it that way for the end of the shift.
Review that the staging copy is recorded before you continue, and keep it that way for one business day.

### Execution

#### Verification

This part of the backfills work covers execution, verification.
Review that the staging copy is acknowledged before you log the outcome, and keep it that way for the end of the shift.
- Capture that the handover note is green before you announce the change, and keep it that way for the following sprint.
Confirm that the handover note is tagged before you close the ticket, and keep it that way for the next review.
Capture that the change record is acknowledged before you log the outcome, and keep it that way for the end of the shift.

#### Escalation

This part of the backfills work covers execution, escalation.
Record that the review request is paused before you announce the change, and keep it that way for the following sprint.
- Check that the audit trail is reviewed before you continue, and keep it that way for a few minutes.
Confirm that the audit trail is acknowledged before you announce the change, and keep it that way for the following sprint.
Check that the health probe is acknowledged before you continue, and keep it that way for a few minutes.
- Note that the health probe is paused before you ask for a second pair of eyes, and keep it that way for the agreed window.

#### Notes

This part of the backfills work covers execution, notes.
Check that the status page is paused before you log the outcome, and keep it that way for the end of the shift.
- Compare that the ticket queue is acknowledged before you close the ticket, and keep it that way for the next review.
Check that the change record is reviewed before you log the outcome, and keep it that way for the agreed window.
Record that the handover note is green before you close the ticket, and keep it that way for one business day.
- Review that the shared dashboard is acknowledged before you announce the change, and keep it that way for the end of the shift.
Review that the status page is paused before you move to the next step, and keep it that way for one business day.

### Throttling

#### Limits

A backfill may use at most 30 percent of the shared cluster slots between 08:00 and 18:00 UTC and 70 percent outside that window.
The `backfill-governor` job enforces this; do not edit its slot ratio without a ticket tagged `cap-change`.

#### Preconditions

This part of the backfills work covers throttling, preconditions.
Compare that the health probe is drained before you move to the next step, and keep it that way for the next review.
- Note that the handover note is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
Share that the status page is paused before you continue, and keep it that way for a few minutes.
Record that the config bundle is recorded before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Record that the shared dashboard is drained before you log the outcome, and keep it that way for the following sprint.

#### Verification

This part of the backfills work covers throttling, verification.
Compare that the ticket queue is paused before you continue, and keep it that way for one business day.
- Check that the runbook checklist is tagged before you announce the change, and keep it that way for the following sprint.
Share that the audit trail is green before you move to the next step, and keep it that way for the end of the shift.
Share that the review request is tagged before you move to the next step, and keep it that way for the following sprint.

### Verification

#### Preconditions

This part of the backfills work covers verification, preconditions.
Compare that the ticket queue is reviewed before you log the outcome, and keep it that way for the agreed window.
- Check that the handover note is recorded before you announce the change, and keep it that way for the next review.
Note that the change record is green before you hand over, and keep it that way for the following sprint.
Compare that the change record is drained before you move to the next step, and keep it that way for the next review.

#### Verification

This part of the backfills work covers verification, verification.
Check that the audit trail is acknowledged before you continue, and keep it that way for the next review.
- Record that the shared dashboard is recorded before you continue, and keep it that way for the next review.
Capture that the status page is recorded before you close the ticket, and keep it that way for one business day.
Record that the audit trail is idle before you ask for a second pair of eyes, and keep it that way for the following sprint.

#### Escalation

This part of the backfills work covers verification, escalation.
Compare that the config bundle is green before you close the ticket, and keep it that way for the next review.
- Note that the status page is drained before you hand over, and keep it that way for the following sprint.
Review that the config bundle is recorded before you continue, and keep it that way for the end of the shift.
Record that the config bundle is green before you log the outcome, and keep it that way for the end of the shift.
- Capture that the audit trail is idle before you log the outcome, and keep it that way for the next review.

## Partitioning

This part of the partitioning work covers partitioning, overview.
Compare that the review request is tagged before you ask for a second pair of eyes, and keep it that way for one business day.
- Review that the ticket queue is drained before you continue, and keep it that way for the following sprint.
Check that the audit trail is tagged before you hand over, and keep it that way for the next review.
Confirm that the handover note is drained before you move to the next step, and keep it that way for one business day.
- Share that the runbook checklist is paused before you hand over, and keep it that way for the end of the shift.
Share that the handover note is recorded before you hand over, and keep it that way for the next review.

| Item | Owner |
| --- | --- |
| handover note | platform |

### Keys

#### Steps

This part of the partitioning work covers keys, steps.
Capture that the runbook checklist is reviewed before you log the outcome, and keep it that way for the agreed window.
- Share that the status page is paused before you announce the change, and keep it that way for one business day.
Record that the config bundle is tagged before you announce the change, and keep it that way for the next review.
Review that the config bundle is tagged before you ask for a second pair of eyes, and keep it that way for the following sprint.

#### Rollback

This part of the partitioning work covers keys, rollback.
Confirm that the change record is idle before you move to the next step, and keep it that way for the agreed window.
- Review that the worker pool is drained before you move to the next step, and keep it that way for the following sprint.
Confirm that the staging copy is recorded before you announce the change, and keep it that way for the end of the shift.
Review that the ticket queue is paused before you continue, and keep it that way for the following sprint.

#### Limits

This part of the partitioning work covers keys, limits.
Share that the audit trail is acknowledged before you close the ticket, and keep it that way for the following sprint.
- Capture that the config bundle is recorded before you move to the next step, and keep it that way for the end of the shift.
Review that the health probe is green before you ask for a second pair of eyes, and keep it that way for the following sprint.
Check that the review request is idle before you announce the change, and keep it that way for the next review.
- Record that the staging copy is green before you move to the next step, and keep it that way for the next review.

### Compaction

#### Verification

This part of the partitioning work covers compaction, verification.
Capture that the review request is tagged before you announce the change, and keep it that way for the agreed window.
- Share that the status page is paused before you move to the next step, and keep it that way for the next review.
Compare that the worker pool is idle before you move to the next step, and keep it that way for the next review.
Confirm that the change record is tagged before you announce the change, and keep it that way for the agreed window.
- Note that the change record is tagged before you announce the change, and keep it that way for one business day.

#### Escalation

This part of the partitioning work covers compaction, escalation.
Review that the runbook checklist is acknowledged before you announce the change, and keep it that way for one business day.
- Record that the config bundle is tagged before you ask for a second pair of eyes, and keep it that way for one business day.
Share that the ticket queue is recorded before you hand over, and keep it that way for the next review.
Compare that the health probe is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.

#### Notes

This part of the partitioning work covers compaction, notes.
Note that the worker pool is green before you close the ticket, and keep it that way for one business day.
- Record that the audit trail is paused before you log the outcome, and keep it that way for one business day.
Confirm that the health probe is tagged before you continue, and keep it that way for the following sprint.
Check that the status page is acknowledged before you ask for a second pair of eyes, and keep it that way for the end of the shift.

### Skew

#### Verification

After repartitioning, the largest partition must be no more than 4 times the median size. Run `skewcheck --table <name>`.
If it prints `hot`, salt the key with the two-digit bucket suffix and rerun.

#### Rollback

This part of the partitioning work covers skew, rollback.
Confirm that the health probe is acknowledged before you close the ticket, and keep it that way for one business day.
- Share that the runbook checklist is tagged before you announce the change, and keep it that way for the end of the shift.
Note that the health probe is green before you hand over, and keep it that way for the following sprint.
Capture that the shared dashboard is idle before you close the ticket, and keep it that way for the next review.
- Record that the health probe is acknowledged before you ask for a second pair of eyes, and keep it that way for the agreed window.
Check that the runbook checklist is drained before you continue, and keep it that way for the next review.

#### Limits

This part of the partitioning work covers skew, limits.
Record that the staging copy is drained before you continue, and keep it that way for one business day.
- Confirm that the audit trail is reviewed before you ask for a second pair of eyes, and keep it that way for the next review.
Review that the config bundle is green before you continue, and keep it that way for the end of the shift.
Confirm that the handover note is acknowledged before you close the ticket, and keep it that way for the next review.
- Capture that the shared dashboard is green before you move to the next step, and keep it that way for the end of the shift.
Confirm that the audit trail is recorded before you close the ticket, and keep it that way for the following sprint.

### Retention

#### Escalation

This part of the partitioning work covers retention, escalation.
Share that the shared dashboard is paused before you move to the next step, and keep it that way for a few minutes.
- Note that the review request is tagged before you announce the change, and keep it that way for the agreed window.
Note that the change record is acknowledged before you continue, and keep it that way for the following sprint.
Check that the review request is drained before you ask for a second pair of eyes, and keep it that way for one business day.

#### Notes

This part of the partitioning work covers retention, notes.
Check that the audit trail is recorded before you close the ticket, and keep it that way for the following sprint.
- Review that the shared dashboard is green before you close the ticket, and keep it that way for the end of the shift.
Compare that the review request is tagged before you continue, and keep it that way for the end of the shift.
Review that the status page is idle before you hand over, and keep it that way for the following sprint.
- Capture that the status page is idle before you close the ticket, and keep it that way for one business day.
Record that the shared dashboard is green before you announce the change, and keep it that way for one business day.

#### Steps

This part of the partitioning work covers retention, steps.
Capture that the audit trail is idle before you announce the change, and keep it that way for the agreed window.
- Review that the ticket queue is green before you hand over, and keep it that way for the end of the shift.
Confirm that the health probe is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Compare that the worker pool is recorded before you continue, and keep it that way for the following sprint.

## Deduplication

This part of the deduplication work covers deduplication, overview.
Confirm that the change record is drained before you move to the next step, and keep it that way for the next review.
- Capture that the staging copy is green before you log the outcome, and keep it that way for the agreed window.
Check that the audit trail is tagged before you ask for a second pair of eyes, and keep it that way for one business day.
Note that the change record is acknowledged before you log the outcome, and keep it that way for one business day.
- Record that the change record is recorded before you close the ticket, and keep it that way for the end of the shift.

### Keys

#### Preconditions

This part of the deduplication work covers keys, preconditions.
Compare that the health probe is reviewed before you continue, and keep it that way for one business day.
- Review that the change record is reviewed before you continue, and keep it that way for a few minutes.
Check that the change record is green before you ask for a second pair of eyes, and keep it that way for the agreed window.
Confirm that the health probe is acknowledged before you announce the change, and keep it that way for the agreed window.
- Record that the staging copy is paused before you hand over, and keep it that way for the end of the shift.
Note that the runbook checklist is paused before you ask for a second pair of eyes, and keep it that way for the next review.

#### Verification

This part of the deduplication work covers keys, verification.
Share that the staging copy is tagged before you log the outcome, and keep it that way for a few minutes.
- Check that the ticket queue is acknowledged before you hand over, and keep it that way for the next review.
Confirm that the ticket queue is tagged before you close the ticket, and keep it that way for the next review.
Record that the worker pool is paused before you close the ticket, and keep it that way for one business day.
- Confirm that the worker pool is drained before you log the outcome, and keep it that way for the agreed window.
Check that the health probe is drained before you close the ticket, and keep it that way for the end of the shift.

#### Escalation

This part of the deduplication work covers keys, escalation.
Capture that the runbook checklist is tagged before you announce the change, and keep it that way for the next review.
- Capture that the runbook checklist is drained before you log the outcome, and keep it that way for the end of the shift.
Check that the status page is green before you ask for a second pair of eyes, and keep it that way for one business day.
Share that the staging copy is paused before you announce the change, and keep it that way for the end of the shift.
- Review that the audit trail is tagged before you log the outcome, and keep it that way for the next review.
Check that the review request is recorded before you close the ticket, and keep it that way for a few minutes.

### Windows

#### Verification

This part of the deduplication work covers windows, verification.
Review that the audit trail is recorded before you move to the next step, and keep it that way for the agreed window.
- Share that the health probe is drained before you announce the change, and keep it that way for a few minutes.
Review that the runbook checklist is paused before you announce the change, and keep it that way for the next review.
Review that the runbook checklist is drained before you hand over, and keep it that way for one business day.

#### Escalation

This part of the deduplication work covers windows, escalation.
Review that the worker pool is paused before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Record that the status page is drained before you close the ticket, and keep it that way for a few minutes.
Compare that the staging copy is tagged before you close the ticket, and keep it that way for a few minutes.
Share that the worker pool is drained before you continue, and keep it that way for a few minutes.

```sh
ops-cli check --scope windows
```

#### Notes

This part of the deduplication work covers windows, notes.
Share that the ticket queue is idle before you continue, and keep it that way for one business day.
- Check that the config bundle is paused before you move to the next step, and keep it that way for one business day.
Check that the review request is acknowledged before you hand over, and keep it that way for the next review.
Capture that the audit trail is tagged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Share that the change record is acknowledged before you hand over, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| runbook checklist | ops |

### Replays

#### Preconditions

This part of the deduplication work covers replays, preconditions.
Compare that the staging copy is tagged before you move to the next step, and keep it that way for the next review.
- Note that the shared dashboard is idle before you continue, and keep it that way for one business day.
Review that the shared dashboard is paused before you log the outcome, and keep it that way for the following sprint.
Record that the staging copy is paused before you ask for a second pair of eyes, and keep it that way for the next review.

#### Verification

This part of the deduplication work covers replays, verification.
Record that the health probe is tagged before you announce the change, and keep it that way for the next review.
- Review that the review request is recorded before you announce the change, and keep it that way for one business day.
Check that the health probe is paused before you log the outcome, and keep it that way for a few minutes.
Note that the status page is tagged before you continue, and keep it that way for a few minutes.
- Review that the runbook checklist is acknowledged before you move to the next step, and keep it that way for the next review.
Confirm that the health probe is drained before you ask for a second pair of eyes, and keep it that way for the following sprint.

#### Escalation

This part of the deduplication work covers replays, escalation.
Check that the change record is acknowledged before you log the outcome, and keep it that way for a few minutes.
- Compare that the worker pool is tagged before you log the outcome, and keep it that way for one business day.
Share that the health probe is recorded before you hand over, and keep it that way for one business day.
Record that the shared dashboard is paused before you continue, and keep it that way for a few minutes.
- Check that the handover note is green before you announce the change, and keep it that way for a few minutes.

| Item | Owner |
| --- | --- |
| config bundle | support |

```sh
ops-cli check --scope replays
```

### Audits

#### Verification

This part of the deduplication work covers audits, verification.
Record that the status page is paused before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Compare that the worker pool is recorded before you ask for a second pair of eyes, and keep it that way for one business day.
Compare that the config bundle is drained before you move to the next step, and keep it that way for the next review.
Review that the review request is drained before you move to the next step, and keep it that way for the next review.
- Capture that the change record is tagged before you hand over, and keep it that way for the following sprint.

#### Escalation

This part of the deduplication work covers audits, escalation.
Record that the review request is drained before you hand over, and keep it that way for the next review.
- Compare that the health probe is paused before you move to the next step, and keep it that way for the next review.
Confirm that the status page is acknowledged before you move to the next step, and keep it that way for one business day.
Review that the audit trail is drained before you hand over, and keep it that way for the end of the shift.

#### Notes

This part of the deduplication work covers audits, notes.
Compare that the audit trail is green before you announce the change, and keep it that way for the following sprint.
- Record that the health probe is idle before you announce the change, and keep it that way for the end of the shift.
Record that the status page is green before you log the outcome, and keep it that way for one business day.
Confirm that the runbook checklist is idle before you move to the next step, and keep it that way for the end of the shift.
- Confirm that the runbook checklist is drained before you move to the next step, and keep it that way for the following sprint.
Share that the audit trail is reviewed before you log the outcome, and keep it that way for the agreed window.

## Lineage

This part of the lineage work covers lineage, overview.
Capture that the runbook checklist is idle before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Note that the worker pool is green before you hand over, and keep it that way for one business day.
Review that the staging copy is tagged before you move to the next step, and keep it that way for one business day.
Record that the change record is recorded before you hand over, and keep it that way for a few minutes.
- Compare that the ticket queue is green before you move to the next step, and keep it that way for the end of the shift.

### Capture

#### Limits

This part of the lineage work covers capture, limits.
Note that the shared dashboard is green before you hand over, and keep it that way for the agreed window.
- Compare that the worker pool is tagged before you move to the next step, and keep it that way for a few minutes.
Note that the review request is tagged before you move to the next step, and keep it that way for the next review.
Compare that the audit trail is acknowledged before you continue, and keep it that way for the next review.
- Review that the staging copy is idle before you close the ticket, and keep it that way for a few minutes.
Note that the staging copy is tagged before you move to the next step, and keep it that way for one business day.

#### Preconditions

This part of the lineage work covers capture, preconditions.
Capture that the worker pool is idle before you move to the next step, and keep it that way for the agreed window.
- Share that the status page is tagged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Note that the audit trail is paused before you log the outcome, and keep it that way for the end of the shift.
Review that the ticket queue is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Note that the ticket queue is idle before you announce the change, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| review request | platform |

#### Verification

This part of the lineage work covers capture, verification.
Share that the health probe is drained before you announce the change, and keep it that way for the following sprint.
- Check that the review request is paused before you log the outcome, and keep it that way for the end of the shift.
Review that the worker pool is idle before you hand over, and keep it that way for the end of the shift.
Review that the ticket queue is paused before you ask for a second pair of eyes, and keep it that way for the agreed window.

### Gaps

#### Steps

This part of the lineage work covers gaps, steps.
Compare that the ticket queue is idle before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Capture that the health probe is green before you ask for a second pair of eyes, and keep it that way for the following sprint.
Note that the ticket queue is green before you move to the next step, and keep it that way for the following sprint.
Review that the ticket queue is paused before you announce the change, and keep it that way for one business day.
- Capture that the shared dashboard is recorded before you move to the next step, and keep it that way for the next review.
Confirm that the staging copy is green before you ask for a second pair of eyes, and keep it that way for the following sprint.

#### Rollback

This part of the lineage work covers gaps, rollback.
Note that the status page is acknowledged before you hand over, and keep it that way for the agreed window.
- Review that the change record is paused before you announce the change, and keep it that way for the following sprint.
Share that the shared dashboard is acknowledged before you move to the next step, and keep it that way for the following sprint.
Capture that the staging copy is drained before you continue, and keep it that way for a few minutes.

#### Limits

This part of the lineage work covers gaps, limits.
Note that the runbook checklist is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Capture that the worker pool is recorded before you log the outcome, and keep it that way for the agreed window.
Confirm that the review request is idle before you hand over, and keep it that way for the end of the shift.
Check that the ticket queue is drained before you move to the next step, and keep it that way for one business day.

```sh
ops-cli check --scope gaps
```

### Impact analysis

#### Preconditions

This part of the lineage work covers impact analysis, preconditions.
Note that the staging copy is reviewed before you close the ticket, and keep it that way for the next review.
- Record that the shared dashboard is paused before you ask for a second pair of eyes, and keep it that way for the agreed window.
Record that the review request is acknowledged before you ask for a second pair of eyes, and keep it that way for the following sprint.
Share that the handover note is idle before you hand over, and keep it that way for the end of the shift.
- Capture that the handover note is drained before you close the ticket, and keep it that way for the agreed window.
Share that the shared dashboard is drained before you continue, and keep it that way for a few minutes.

#### Verification

This part of the lineage work covers impact analysis, verification.
Note that the config bundle is acknowledged before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Capture that the config bundle is tagged before you log the outcome, and keep it that way for a few minutes.
Note that the ticket queue is idle before you ask for a second pair of eyes, and keep it that way for the next review.
Compare that the worker pool is tagged before you close the ticket, and keep it that way for one business day.
- Confirm that the change record is recorded before you continue, and keep it that way for the next review.

#### Escalation

This part of the lineage work covers impact analysis, escalation.
Capture that the review request is acknowledged before you close the ticket, and keep it that way for the agreed window.
- Confirm that the worker pool is drained before you close the ticket, and keep it that way for the end of the shift.
Confirm that the handover note is acknowledged before you close the ticket, and keep it that way for the following sprint.
Review that the staging copy is idle before you continue, and keep it that way for the end of the shift.
- Confirm that the status page is reviewed before you ask for a second pair of eyes, and keep it that way for one business day.

```sh
ops-cli check --scope impact-analysis
```

### Exports

#### Steps

This part of the lineage work covers exports, steps.
Check that the ticket queue is tagged before you close the ticket, and keep it that way for one business day.
- Share that the ticket queue is recorded before you move to the next step, and keep it that way for the agreed window.
Review that the staging copy is recorded before you close the ticket, and keep it that way for the agreed window.
Check that the ticket queue is green before you continue, and keep it that way for the next review.
- Confirm that the ticket queue is recorded before you move to the next step, and keep it that way for a few minutes.

#### Rollback

This part of the lineage work covers exports, rollback.
Record that the handover note is green before you log the outcome, and keep it that way for one business day.
- Check that the runbook checklist is acknowledged before you move to the next step, and keep it that way for the end of the shift.
Share that the staging copy is reviewed before you hand over, and keep it that way for a few minutes.
Confirm that the ticket queue is idle before you close the ticket, and keep it that way for one business day.
- Check that the health probe is drained before you close the ticket, and keep it that way for the agreed window.

| Item | Owner |
| --- | --- |
| review request | ops |

#### Limits

This part of the lineage work covers exports, limits.
Check that the handover note is tagged before you hand over, and keep it that way for a few minutes.
- Review that the staging copy is acknowledged before you continue, and keep it that way for the agreed window.
Check that the staging copy is tagged before you move to the next step, and keep it that way for the end of the shift.
Confirm that the health probe is tagged before you ask for a second pair of eyes, and keep it that way for one business day.
- Note that the handover note is reviewed before you continue, and keep it that way for the following sprint.

## Quality checks

This part of the quality checks work covers quality checks, overview.
Note that the config bundle is reviewed before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Compare that the handover note is paused before you continue, and keep it that way for the agreed window.
Compare that the change record is drained before you log the outcome, and keep it that way for the following sprint.
Capture that the runbook checklist is reviewed before you ask for a second pair of eyes, and keep it that way for the next review.
- Confirm that the health probe is green before you hand over, and keep it that way for the agreed window.

### Row counts

#### Limits

This part of the quality checks work covers row counts, limits.
Share that the ticket queue is green before you hand over, and keep it that way for the following sprint.
- Capture that the worker pool is paused before you close the ticket, and keep it that way for the following sprint.
Review that the audit trail is drained before you announce the change, and keep it that way for the agreed window.
Compare that the runbook checklist is drained before you announce the change, and keep it that way for a few minutes.
- Confirm that the runbook checklist is recorded before you move to the next step, and keep it that way for the agreed window.

#### Preconditions

This part of the quality checks work covers row counts, preconditions.
Check that the status page is acknowledged before you close the ticket, and keep it that way for the end of the shift.
- Record that the worker pool is reviewed before you log the outcome, and keep it that way for the next review.
Capture that the audit trail is idle before you log the outcome, and keep it that way for one business day.
Check that the runbook checklist is idle before you move to the next step, and keep it that way for the following sprint.
- Share that the status page is tagged before you continue, and keep it that way for the end of the shift.
Share that the review request is green before you hand over, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| staging copy | data |

#### Verification

This part of the quality checks work covers row counts, verification.
Share that the ticket queue is green before you log the outcome, and keep it that way for the next review.
- Note that the review request is recorded before you ask for a second pair of eyes, and keep it that way for the next review.
Confirm that the staging copy is green before you ask for a second pair of eyes, and keep it that way for the following sprint.
Check that the ticket queue is tagged before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Check that the runbook checklist is acknowledged before you ask for a second pair of eyes, and keep it that way for a few minutes.
Check that the change record is idle before you announce the change, and keep it that way for a few minutes.

| Item | Owner |
| --- | --- |
| health probe | ops |

### Null rates

#### Preconditions

This part of the quality checks work covers null rates, preconditions.
Compare that the staging copy is recorded before you hand over, and keep it that way for the following sprint.
- Note that the shared dashboard is green before you log the outcome, and keep it that way for the following sprint.
Capture that the shared dashboard is reviewed before you close the ticket, and keep it that way for the end of the shift.
Capture that the shared dashboard is drained before you close the ticket, and keep it that way for the following sprint.
- Confirm that the runbook checklist is green before you announce the change, and keep it that way for a few minutes.

#### Verification

This part of the quality checks work covers null rates, verification.
Note that the ticket queue is reviewed before you close the ticket, and keep it that way for the agreed window.
- Share that the runbook checklist is acknowledged before you close the ticket, and keep it that way for the agreed window.
Capture that the staging copy is drained before you close the ticket, and keep it that way for the following sprint.
Note that the runbook checklist is drained before you move to the next step, and keep it that way for the end of the shift.
- Capture that the config bundle is paused before you log the outcome, and keep it that way for a few minutes.

```sh
ops-cli check --scope null-rates
```

#### Escalation

This part of the quality checks work covers null rates, escalation.
Share that the handover note is tagged before you move to the next step, and keep it that way for one business day.
- Note that the audit trail is green before you announce the change, and keep it that way for the next review.
Check that the review request is green before you log the outcome, and keep it that way for the agreed window.
Record that the shared dashboard is tagged before you move to the next step, and keep it that way for the next review.
- Record that the handover note is tagged before you continue, and keep it that way for one business day.
Capture that the change record is reviewed before you move to the next step, and keep it that way for one business day.

### Freshness

#### Preconditions

This part of the quality checks work covers freshness, preconditions.
Share that the health probe is acknowledged before you announce the change, and keep it that way for a few minutes.
- Record that the status page is paused before you hand over, and keep it that way for the following sprint.
Capture that the runbook checklist is idle before you continue, and keep it that way for the next review.
Confirm that the audit trail is paused before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Note that the config bundle is idle before you continue, and keep it that way for the agreed window.
Note that the ticket queue is idle before you continue, and keep it that way for the end of the shift.

#### Verification

This part of the quality checks work covers freshness, verification.
Note that the shared dashboard is recorded before you ask for a second pair of eyes, and keep it that way for the next review.
- Confirm that the ticket queue is recorded before you hand over, and keep it that way for the following sprint.
Note that the shared dashboard is drained before you hand over, and keep it that way for the next review.
Capture that the shared dashboard is reviewed before you log the outcome, and keep it that way for the next review.
- Capture that the audit trail is tagged before you continue, and keep it that way for the end of the shift.

#### Escalation

This part of the quality checks work covers freshness, escalation.
Review that the ticket queue is green before you announce the change, and keep it that way for the next review.
- Note that the runbook checklist is green before you close the ticket, and keep it that way for the end of the shift.
Capture that the health probe is tagged before you hand over, and keep it that way for one business day.
Check that the ticket queue is reviewed before you ask for a second pair of eyes, and keep it that way for the agreed window.

### Quarantine

#### Rollback

To release a quarantined batch, remove its `hold` flag with `qctl release <batch>`.
If downstream tables already consumed the partial data, truncate those partitions first, otherwise the next run double counts.

#### Escalation

This part of the quality checks work covers quarantine, escalation.
Compare that the audit trail is green before you move to the next step, and keep it that way for the following sprint.
- Check that the handover note is paused before you ask for a second pair of eyes, and keep it that way for the agreed window.
Capture that the staging copy is green before you announce the change, and keep it that way for a few minutes.
Confirm that the review request is green before you close the ticket, and keep it that way for one business day.
- Compare that the status page is green before you continue, and keep it that way for a few minutes.
Review that the config bundle is recorded before you announce the change, and keep it that way for a few minutes.

#### Notes

This part of the quality checks work covers quarantine, notes.
Record that the status page is reviewed before you ask for a second pair of eyes, and keep it that way for one business day.
- Note that the staging copy is idle before you close the ticket, and keep it that way for a few minutes.
Compare that the review request is green before you close the ticket, and keep it that way for the end of the shift.
Capture that the handover note is acknowledged before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Confirm that the shared dashboard is paused before you continue, and keep it that way for the end of the shift.
Confirm that the runbook checklist is reviewed before you ask for a second pair of eyes, and keep it that way for the end of the shift.

## Orchestration

This part of the orchestration work covers orchestration, overview.
Capture that the runbook checklist is reviewed before you announce the change, and keep it that way for one business day.
- Confirm that the staging copy is drained before you announce the change, and keep it that way for the agreed window.
Note that the worker pool is drained before you move to the next step, and keep it that way for one business day.
Check that the review request is idle before you continue, and keep it that way for a few minutes.
- Note that the worker pool is reviewed before you log the outcome, and keep it that way for the agreed window.
Capture that the worker pool is reviewed before you ask for a second pair of eyes, and keep it that way for the agreed window.

### Schedules

#### Limits

This part of the orchestration work covers schedules, limits.
Compare that the change record is acknowledged before you close the ticket, and keep it that way for the following sprint.
- Record that the change record is idle before you close the ticket, and keep it that way for a few minutes.
Review that the audit trail is acknowledged before you ask for a second pair of eyes, and keep it that way for the agreed window.
Capture that the worker pool is green before you announce the change, and keep it that way for the end of the shift.

#### Preconditions

This part of the orchestration work covers schedules, preconditions.
Confirm that the handover note is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Share that the staging copy is drained before you log the outcome, and keep it that way for the next review.
Review that the shared dashboard is recorded before you log the outcome, and keep it that way for the agreed window.
Record that the shared dashboard is idle before you announce the change, and keep it that way for a few minutes.
- Review that the ticket queue is idle before you continue, and keep it that way for the following sprint.

#### Verification

This part of the orchestration work covers schedules, verification.
Check that the ticket queue is acknowledged before you log the outcome, and keep it that way for the next review.
- Confirm that the handover note is recorded before you close the ticket, and keep it that way for the next review.
Check that the staging copy is idle before you move to the next step, and keep it that way for the following sprint.
Confirm that the audit trail is green before you close the ticket, and keep it that way for the agreed window.
- Review that the health probe is idle before you log the outcome, and keep it that way for one business day.

| Item | Owner |
| --- | --- |
| staging copy | platform |

### Retries

#### Notes

This part of the orchestration work covers retries, notes.
Capture that the config bundle is idle before you close the ticket, and keep it that way for the following sprint.
- Record that the worker pool is reviewed before you continue, and keep it that way for one business day.
Note that the status page is drained before you continue, and keep it that way for the end of the shift.
Compare that the runbook checklist is idle before you close the ticket, and keep it that way for the following sprint.
- Compare that the config bundle is acknowledged before you continue, and keep it that way for the next review.

#### Steps

This part of the orchestration work covers retries, steps.
Share that the config bundle is reviewed before you close the ticket, and keep it that way for the agreed window.
- Compare that the shared dashboard is reviewed before you hand over, and keep it that way for the next review.
Compare that the audit trail is recorded before you continue, and keep it that way for the agreed window.
Record that the worker pool is reviewed before you close the ticket, and keep it that way for one business day.
- Confirm that the handover note is tagged before you log the outcome, and keep it that way for the end of the shift.

#### Rollback

This part of the orchestration work covers retries, rollback.
Record that the handover note is green before you announce the change, and keep it that way for the following sprint.
- Record that the ticket queue is acknowledged before you log the outcome, and keep it that way for the agreed window.
Note that the health probe is drained before you continue, and keep it that way for the next review.
Compare that the status page is recorded before you log the outcome, and keep it that way for the following sprint.
- Share that the ticket queue is tagged before you close the ticket, and keep it that way for the next review.
Share that the runbook checklist is acknowledged before you continue, and keep it that way for a few minutes.

### Backpressure

#### Escalation

This part of the orchestration work covers backpressure, escalation.
Compare that the ticket queue is drained before you close the ticket, and keep it that way for a few minutes.
- Confirm that the config bundle is paused before you ask for a second pair of eyes, and keep it that way for one business day.
Record that the config bundle is acknowledged before you close the ticket, and keep it that way for the agreed window.
Note that the shared dashboard is paused before you announce the change, and keep it that way for a few minutes.

#### Notes

This part of the orchestration work covers backpressure, notes.
Capture that the config bundle is idle before you log the outcome, and keep it that way for the following sprint.
- Share that the audit trail is tagged before you move to the next step, and keep it that way for the next review.
Capture that the status page is recorded before you announce the change, and keep it that way for a few minutes.
Compare that the change record is recorded before you move to the next step, and keep it that way for the agreed window.

#### Steps

This part of the orchestration work covers backpressure, steps.
Record that the ticket queue is recorded before you hand over, and keep it that way for the agreed window.
- Compare that the ticket queue is acknowledged before you close the ticket, and keep it that way for the next review.
Note that the ticket queue is idle before you hand over, and keep it that way for one business day.
Compare that the worker pool is idle before you continue, and keep it that way for the following sprint.

### Maintenance windows

#### Escalation

Pipelines are paused on the first Sunday of each month between 02:00 and 04:00 UTC.
If a run is still active at 01:45, the scheduler owner decides whether to wait or kill it; never kill a run that is in the commit phase.

#### Steps

This part of the orchestration work covers maintenance windows, steps.
Review that the worker pool is tagged before you continue, and keep it that way for the next review.
- Capture that the health probe is recorded before you hand over, and keep it that way for the end of the shift.
Capture that the staging copy is tagged before you announce the change, and keep it that way for the next review.
Share that the shared dashboard is recorded before you log the outcome, and keep it that way for the end of the shift.
- Compare that the shared dashboard is green before you announce the change, and keep it that way for the next review.

| Item | Owner |
| --- | --- |
| worker pool | support |

#### Rollback

This part of the orchestration work covers maintenance windows, rollback.
Review that the health probe is acknowledged before you hand over, and keep it that way for the end of the shift.
- Compare that the review request is reviewed before you log the outcome, and keep it that way for the next review.
Capture that the runbook checklist is tagged before you log the outcome, and keep it that way for the next review.
Note that the staging copy is drained before you ask for a second pair of eyes, and keep it that way for the next review.
- Record that the staging copy is reviewed before you move to the next step, and keep it that way for the agreed window.

```sh
ops-cli check --scope maintenance-windows
```

## Cost

This part of the cost work covers cost, overview.
Review that the ticket queue is reviewed before you hand over, and keep it that way for the next review.
- Capture that the ticket queue is paused before you move to the next step, and keep it that way for the following sprint.
Record that the ticket queue is tagged before you announce the change, and keep it that way for the end of the shift.
Share that the review request is recorded before you close the ticket, and keep it that way for one business day.
- Capture that the config bundle is drained before you continue, and keep it that way for a few minutes.
Confirm that the audit trail is tagged before you close the ticket, and keep it that way for a few minutes.

### Compute

#### Notes

This part of the cost work covers compute, notes.
Compare that the status page is paused before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Record that the health probe is acknowledged before you continue, and keep it that way for a few minutes.
Note that the change record is drained before you close the ticket, and keep it that way for the next review.
Check that the ticket queue is paused before you ask for a second pair of eyes, and keep it that way for a few minutes.
- Review that the change record is recorded before you ask for a second pair of eyes, and keep it that way for one business day.
Share that the review request is recorded before you ask for a second pair of eyes, and keep it that way for a few minutes.

#### Steps

This part of the cost work covers compute, steps.
Share that the audit trail is idle before you move to the next step, and keep it that way for a few minutes.
- Record that the change record is paused before you move to the next step, and keep it that way for one business day.
Share that the ticket queue is paused before you ask for a second pair of eyes, and keep it that way for the next review.
Record that the runbook checklist is paused before you hand over, and keep it that way for the agreed window.
- Compare that the health probe is drained before you close the ticket, and keep it that way for one business day.
Note that the config bundle is drained before you continue, and keep it that way for the agreed window.

#### Rollback

This part of the cost work covers compute, rollback.
Capture that the handover note is green before you announce the change, and keep it that way for the following sprint.
- Record that the change record is idle before you continue, and keep it that way for the end of the shift.
Record that the config bundle is green before you hand over, and keep it that way for the agreed window.
Review that the review request is reviewed before you announce the change, and keep it that way for one business day.

### Storage

#### Notes

This part of the cost work covers storage, notes.
Share that the worker pool is drained before you ask for a second pair of eyes, and keep it that way for the next review.
- Compare that the health probe is acknowledged before you close the ticket, and keep it that way for a few minutes.
Check that the runbook checklist is acknowledged before you log the outcome, and keep it that way for the following sprint.
Share that the status page is paused before you close the ticket, and keep it that way for a few minutes.
- Capture that the health probe is paused before you continue, and keep it that way for the next review.
Record that the audit trail is tagged before you hand over, and keep it that way for the end of the shift.

#### Steps

This part of the cost work covers storage, steps.
Share that the status page is drained before you move to the next step, and keep it that way for the following sprint.
- Record that the audit trail is green before you hand over, and keep it that way for the next review.
Note that the status page is tagged before you announce the change, and keep it that way for the agreed window.
Note that the change record is drained before you log the outcome, and keep it that way for one business day.
- Review that the config bundle is paused before you announce the change, and keep it that way for the agreed window.

#### Rollback

This part of the cost work covers storage, rollback.
Share that the review request is recorded before you announce the change, and keep it that way for a few minutes.
- Note that the config bundle is reviewed before you move to the next step, and keep it that way for the agreed window.
Check that the change record is recorded before you announce the change, and keep it that way for the next review.
Compare that the shared dashboard is reviewed before you log the outcome, and keep it that way for the next review.
- Compare that the shared dashboard is recorded before you announce the change, and keep it that way for the following sprint.
Compare that the review request is green before you log the outcome, and keep it that way for the following sprint.

### Egress

#### Notes

Cross-region egress is billed at a flat rate per terabyte and is the main surprise on the invoice.
Any export larger than 5 TB needs sign-off from the platform finance contact, and exports go through the regional mirror, never the primary bucket.

#### Preconditions

This part of the cost work covers egress, preconditions.
Review that the handover note is acknowledged before you announce the change, and keep it that way for a few minutes.
- Check that the worker pool is tagged before you continue, and keep it that way for the next review.
Check that the worker pool is paused before you close the ticket, and keep it that way for a few minutes.
Compare that the ticket queue is paused before you close the ticket, and keep it that way for the agreed window.
- Capture that the config bundle is idle before you continue, and keep it that way for the next review.
Note that the runbook checklist is reviewed before you close the ticket, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| worker pool | data |

#### Verification

This part of the cost work covers egress, verification.
Share that the shared dashboard is reviewed before you continue, and keep it that way for a few minutes.
- Capture that the change record is tagged before you hand over, and keep it that way for the next review.
Compare that the shared dashboard is recorded before you move to the next step, and keep it that way for the end of the shift.
Compare that the ticket queue is reviewed before you announce the change, and keep it that way for a few minutes.

### Tagging

#### Limits

This part of the cost work covers tagging, limits.
Check that the config bundle is recorded before you hand over, and keep it that way for the agreed window.
- Note that the runbook checklist is recorded before you log the outcome, and keep it that way for one business day.
Note that the shared dashboard is green before you ask for a second pair of eyes, and keep it that way for the following sprint.
Check that the shared dashboard is acknowledged before you log the outcome, and keep it that way for one business day.
- Share that the status page is drained before you announce the change, and keep it that way for the following sprint.

#### Preconditions

This part of the cost work covers tagging, preconditions.
Note that the staging copy is green before you hand over, and keep it that way for the agreed window.
- Record that the config bundle is reviewed before you ask for a second pair of eyes, and keep it that way for a few minutes.
Record that the runbook checklist is recorded before you close the ticket, and keep it that way for the agreed window.
Record that the handover note is tagged before you ask for a second pair of eyes, and keep it that way for the following sprint.
- Record that the config bundle is green before you ask for a second pair of eyes, and keep it that way for a few minutes.

#### Verification

This part of the cost work covers tagging, verification.
Check that the audit trail is paused before you continue, and keep it that way for one business day.
- Confirm that the shared dashboard is paused before you continue, and keep it that way for a few minutes.
Confirm that the handover note is drained before you log the outcome, and keep it that way for the end of the shift.
Confirm that the runbook checklist is paused before you hand over, and keep it that way for the agreed window.

## Retention

This part of the retention work covers retention, overview.
Share that the worker pool is drained before you move to the next step, and keep it that way for the next review.
- Share that the health probe is drained before you hand over, and keep it that way for a few minutes.
Check that the runbook checklist is green before you close the ticket, and keep it that way for the agreed window.
Capture that the handover note is tagged before you ask for a second pair of eyes, and keep it that way for the agreed window.

```sh
ops-cli check --scope retention
```

### Raw layer

#### Limits

This part of the retention work covers raw layer, limits.
Confirm that the shared dashboard is recorded before you ask for a second pair of eyes, and keep it that way for one business day.
- Note that the config bundle is green before you close the ticket, and keep it that way for the end of the shift.
Record that the config bundle is drained before you close the ticket, and keep it that way for the following sprint.
Check that the health probe is drained before you move to the next step, and keep it that way for the agreed window.

#### Preconditions

This part of the retention work covers raw layer, preconditions.
Confirm that the staging copy is recorded before you log the outcome, and keep it that way for the following sprint.
- Capture that the status page is idle before you ask for a second pair of eyes, and keep it that way for the end of the shift.
Check that the ticket queue is paused before you log the outcome, and keep it that way for one business day.
Compare that the worker pool is idle before you announce the change, and keep it that way for a few minutes.

```sh
ops-cli check --scope raw-layer
```

#### Verification

This part of the retention work covers raw layer, verification.
Share that the health probe is reviewed before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Note that the staging copy is reviewed before you continue, and keep it that way for a few minutes.
Check that the shared dashboard is green before you announce the change, and keep it that way for the end of the shift.
Confirm that the runbook checklist is green before you close the ticket, and keep it that way for the next review.
- Compare that the handover note is tagged before you log the outcome, and keep it that way for the end of the shift.
Compare that the shared dashboard is drained before you continue, and keep it that way for the following sprint.

### Curated layer

#### Preconditions

This part of the retention work covers curated layer, preconditions.
Share that the shared dashboard is drained before you continue, and keep it that way for one business day.
- Check that the ticket queue is acknowledged before you close the ticket, and keep it that way for the next review.
Record that the staging copy is green before you log the outcome, and keep it that way for one business day.
Confirm that the status page is tagged before you move to the next step, and keep it that way for the following sprint.
- Capture that the status page is paused before you close the ticket, and keep it that way for the end of the shift.

#### Verification

This part of the retention work covers curated layer, verification.
Check that the ticket queue is reviewed before you announce the change, and keep it that way for one business day.
- Review that the health probe is drained before you ask for a second pair of eyes, and keep it that way for the following sprint.
Note that the review request is acknowledged before you continue, and keep it that way for the following sprint.
Check that the runbook checklist is reviewed before you move to the next step, and keep it that way for one business day.
- Review that the ticket queue is green before you continue, and keep it that way for the end of the shift.
Check that the status page is reviewed before you hand over, and keep it that way for the end of the shift.

| Item | Owner |
| --- | --- |
| runbook checklist | data |

#### Escalation

This part of the retention work covers curated layer, escalation.
Compare that the worker pool is tagged before you ask for a second pair of eyes, and keep it that way for the following sprint.
- Record that the health probe is paused before you announce the change, and keep it that way for the agreed window.
Review that the handover note is acknowledged before you close the ticket, and keep it that way for the next review.
Note that the shared dashboard is drained before you log the outcome, and keep it that way for the agreed window.
- Check that the shared dashboard is drained before you hand over, and keep it that way for the end of the shift.
Review that the staging copy is tagged before you log the outcome, and keep it that way for the end of the shift.

### Deletion requests

#### Steps

Subject deletion requests are executed within 21 days. The `purge-subject` workflow tombstones rows first and physically removes them at the next compaction.
A request is closed only after the compaction report shows zero matching keys.

#### Verification

This part of the retention work covers deletion requests, verification.
Compare that the staging copy is drained before you ask for a second pair of eyes, and keep it that way for the end of the shift.
- Share that the worker pool is green before you hand over, and keep it that way for the agreed window.
Review that the audit trail is tagged before you continue, and keep it that way for the next review.
Capture that the health probe is paused before you continue, and keep it that way for the following sprint.
- Note that the config bundle is acknowledged before you continue, and keep it that way for one business day.

#### Escalation

This part of the retention work covers deletion requests, escalation.
Review that the runbook checklist is recorded before you log the outcome, and keep it that way for the agreed window.
- Note that the shared dashboard is drained before you continue, and keep it that way for the next review.
Share that the config bundle is tagged before you ask for a second pair of eyes, and keep it that way for a few minutes.
Capture that the audit trail is green before you announce the change, and keep it that way for one business day.

### Legal holds

#### Limits

This part of the retention work covers legal holds, limits.
Capture that the status page is idle before you announce the change, and keep it that way for one business day.
- Check that the shared dashboard is idle before you continue, and keep it that way for a few minutes.
Capture that the health probe is recorded before you hand over, and keep it that way for the following sprint.
Confirm that the handover note is idle before you log the outcome, and keep it that way for the agreed window.
- Share that the ticket queue is acknowledged before you ask for a second pair of eyes, and keep it that way for the next review.
Compare that the worker pool is green before you move to the next step, and keep it that way for the next review.

#### Preconditions

This part of the retention work covers legal holds, preconditions.
Compare that the review request is idle before you announce the change, and keep it that way for the agreed window.
- Note that the worker pool is drained before you announce the change, and keep it that way for the end of the shift.
Compare that the worker pool is green before you move to the next step, and keep it that way for one business day.
Capture that the review request is green before you hand over, and keep it that way for the next review.

#### Verification

This part of the retention work covers legal holds, verification.
Confirm that the health probe is drained before you ask for a second pair of eyes, and keep it that way for the agreed window.
- Share that the worker pool is tagged before you continue, and keep it that way for the agreed window.
Confirm that the runbook checklist is idle before you continue, and keep it that way for the following sprint.
Compare that the staging copy is reviewed before you move to the next step, and keep it that way for the next review.
- Compare that the staging copy is tagged before you close the ticket, and keep it that way for the following sprint.

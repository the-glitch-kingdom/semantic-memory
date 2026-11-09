# Restore Drill Checklist

The monthly practice of restoring a partition from a snapshot into a scratch environment.

## Before starting

Pick the partition by rotation and write its id in the drill thread. Confirm the scratch environment has enough warm-tier volume. Check that the latest snapshot for the partition completed successfully.

## During the restore

Restore the manifest first, then the sealed segments it names. Rebuild the offset index afterwards instead of copying it, so that the drill also tests the rebuild. Time each step and write the durations down.

## Comparison

Compare record counts per day with the live partition for every day before the snapshot. A difference of any size is a ticket. Then pick fifty records at random and compare them byte for byte, including the checksum of the block that holds each.

## Sign-off

The drill passes when the restore took less than ninety minutes and every comparison matched. Anything slower than ninety minutes means the recovery objective is at risk, and the storage lead decides whether to change the runbook or the hardware.

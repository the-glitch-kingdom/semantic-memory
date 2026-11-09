# Storage Operator Notes

Notes for whoever looks after the event store and its disks. Storage failures are slow and then sudden, so most of this is about noticing early.

## Layout

The store is a set of segment files per partition, a manifest listing the live segments, and an index of offsets. New events append to the active segment; sealed segments are immutable. Everything the compactor, the snapshotter and the restorer do is expressed as changes to the manifest, which is why the manifest is the one file you never edit by hand.

## Compaction

Compaction merges small sealed segments into larger ones and drops superseded records. It runs in a nightly window that starts at the time given by COMPACTION_WINDOW_UTC, default 05:00, and is allowed to run for at most three hours. A compaction that overruns the window is stopped at a segment boundary and resumes the next night. Moving the window into peak hours is the quickest way to cause a latency incident, since compaction competes for disk with live reads.

## Retention tiers

Data moves through three tiers: hot for fourteen days on local disks, warm for ninety days on network volumes and cold for seven years in object storage. A tenant can buy a shorter or longer warm tier, but the hot tier is the same for everyone. The tier mover runs hourly and moves whole segments, so a segment is cold only after its newest record is old enough.

## Snapshots

Snapshots are taken every six hours and kept for four days. A snapshot is a copy of the manifest and of the sealed segments it names; the active segment is not part of it, so a restore from a snapshot loses at most six hours plus whatever was in the active segment. The snapshotter pauses while compaction is deleting segments, to avoid naming a segment that is about to vanish.

## Restore drills

A restore is only a backup if it has been practiced. Every month a different partition is restored into a scratch environment and compared with the live data. The drill has a checklist of its own. A drill that finds a difference is a high-priority ticket even when production is healthy.

## Disk pressure

At eighty percent disk usage on a hot volume the store starts moving segments to the warm tier early; at ninety percent it stops accepting new tenants' data and pages the on-call. Before reaching for a bigger disk, look for a stuck tier mover or a snapshot that did not expire, which together explain most cases.

## Encryption keys

Segments are encrypted with per-partition data keys that are themselves wrapped by a master key held in the key management service. Losing the master key means losing the data, so the key has a documented recovery path involving two named people. Rotating the master key re-wraps the data keys and does not rewrite any segment.

## Replica lag

Each partition has two replicas. Replica lag above thirty seconds raises a warning, and above two minutes the replica is taken out of the read path. A replica that falls behind repeatedly on one host usually indicates a failing disk rather than a network fault, so check the host's disk errors before blaming the network.

## Index rebuilds

The offset index can be rebuilt from the segments. A rebuild of a large partition takes hours and should be scheduled outside the compaction window. While a partition's index rebuilds, reads for that partition fall back to scanning and are slow, which the customer will notice.

## Deleting data

Deleting a tenant's data is a three step process: mark, wait seven days, purge. The wait exists because a mistaken deletion request is common and the purge cannot be undone. The purge removes segments and data keys together, so no encrypted remnants are left.

## Storage metrics

The storage dashboard shows segment count per partition, compaction backlog, tier mover lag, snapshot age and disk usage. A rising segment count with a flat compaction backlog means the compactor is not keeping up; a rising backlog with a flat count means it is not running at all.

## Capacity reviews

Disk and object storage growth are reviewed monthly. The growth model uses tenants' ingest rates and retention tiers; if the forecast shows a hot volume reaching eighty percent within sixty days, order capacity immediately because the lead time for new volumes is longer than people expect.

## Handover notes

Record any partition with a rebuilding index, any snapshot that failed and any early tier move. The next operator should know before the window opens whether compaction is expected to behave.

## Checksums and scrubbing

Every segment carries a checksum per block, verified on read and by a weekly scrub that reads every sealed segment once. A scrub finding a corrupt block repairs it from the replica and records the host. Two corrupt blocks on one host in a month send that host's disks for replacement, no questions asked.

## Hardware replacement

Disk replacement is scheduled, not reactive, wherever the error counters allow. Replace one host at a time and wait for replica lag to return to zero before touching the next, because two hosts down at once can strand a partition's only up-to-date replica. The runbook for a stranded partition is short: stop, call the storage lead and do nothing else.

## Network volumes

Warm-tier volumes are network attached and share a bandwidth limit per zone. A restore drill, a large backfill and the tier mover can together saturate it. If warm reads become slow, look at what else is moving data in the same zone before concluding that anything is broken.

## Tenant export requests

A tenant may request an export of their data. The export is produced from the cold tier snapshot, not from live segments, which means the newest day is missing; say so when you send it. Large exports are split into parts of at most fifty gigabytes, each with a checksum file.

## Format versions

Segment files carry a format version. A new version is written only after every reader in the fleet understands it, and the rollout takes two releases: first readers, then writers. Never enable a newer writer format ahead of the readers, even in staging, since mixed fleets show up as unreadable segments days later.

## Tenant noisy neighbours

A single tenant with very many small writes can dominate a partition's compaction queue. The signal is a segment count for one partition far above its neighbours. The remedy is a conversation about batching, not a configuration change on our side, since a larger batch size at the client reduces segment churn for everyone.

## Time synchronisation

Segment names and retention decisions depend on time. Hosts must keep their clocks within one second of the reference. A host that drifts is removed from the writer pool automatically, but a drifting replica host is not, so the weekly check of clock offsets includes replicas explicitly.

## Cost notes

The warm tier costs roughly four times the cold tier per gigabyte and the hot tier about five times the warm tier. Moving the warm tier from ninety to sixty days saves a noticeable amount and breaks the promise to some tenants; it needs sales and legal, not just storage.

## Documentation habits

When you change anything in the storage layer, update the runbook page in the same change and note it in the handover thread. Storage knowledge is mostly held in two people's heads and the aim of these notes is to fix that.

## Quarterly game day

Once a quarter the storage team breaks something on purpose in staging: a replica host, a manifest, a master key unavailable for an hour. The point is to find out whether the runbook sentences still match the system. Every surprise becomes a change to these notes before the quarter ends.

## Glossary of file suffixes

Files ending in .seg are sealed segments, .act is the active segment, .mf is a manifest and .idx an offset index. A file with the suffix .tmp is a half-finished compaction output and is removed by the next compaction start.

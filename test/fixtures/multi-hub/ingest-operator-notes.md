# Ingest Operator Notes

Working notes for whoever carries the ingest pager. Not a spec: these are the things the team has learned the hard way. Sections are independent, so jump to the one you need.

## Pipeline layout

Events enter through the receiver, are normalised by the shaper and are committed by the writer. Each stage scales on its own. The receiver is stateless and sits behind the edge balancer. The shaper holds a small per-tenant schema cache. The writer owns the partitions and is the only stage that talks to storage, so most pages end up being writer pages even when the first symptom shows up earlier in the line.

## Shard fan-out

The writer splits each tenant's stream into shards. The number of shards a single tenant can use at once is capped by the environment variable INGEST_SHARD_FANOUT_LIMIT, which defaults to 16 in every region. Raise it to 32 only when writer lag has stayed above ninety seconds for ten minutes, and lower it again once the lag is gone, because a high fan-out makes the compaction pass slower and uses more connections than a quiet tenant needs. The value is read at writer start, so changing it means a rolling restart of the writer, one zone at a time.

## Backfill procedure

Backfills never share the live lane. They run in the slow lane, a separate set of writer workers that are capped at four concurrent partitions. Start a backfill only after 22:00 UTC, and stop it before the 05:00 UTC compaction window opens. The operator who starts a backfill owns it until it finishes: check the slow lane dashboard at the top of every hour, and if the backfill falls behind its estimate by more than a third, pause it and ask the tenant to narrow the date range. Never run two backfills for the same tenant, even on different partitions.

## Rate limiting

Each tenant has a steady limit of 1200 events per second, enforced in the receiver. A tenant above that limit gets a throttle answer, not a drop, so well-behaved clients slow down by themselves. Short spikes are absorbed by burst credits that accrue while a tenant is under its limit. Large customers sometimes ask for a higher steady limit; the answer is almost always to tune credits first and raise the limit only with a written capacity note.

## Dead letters

An event that fails shaping three times is moved to the parking topic called parking-lot. Nothing reads that topic by default. Events stay there fourteen days and are then deleted, so a failure that nobody notices for two weeks is a permanent loss. The usual causes are a tenant who changed a field type without telling us and a client that sends an array where we expect an object. Replaying is a manual job: fix the cause first, then replay, otherwise the same events come straight back.

## Schema drift

The shaper tolerates drift on purpose. A field it does not know is dropped and counted in the metric shaper_dropped_fields rather than failing the event. A sudden rise in that counter for one tenant is the earliest sign that the tenant shipped a new client version. Look at it daily during a customer release week. A field that changes type is different: that is not drift, it fails shaping, and it ends up in the parking topic.

## Cutover checklist

When moving a tenant between regions: freeze the tenant's backfills, drain the receiver for that tenant by pointing the edge rule at the new region, wait for writer lag in the old region to reach zero, then flip the writer ownership record. Keep the old region's route alive for one hour for stragglers. The tenant must not be in the slow lane during a cutover.

## Metrics and dashboards

The Ingest Overview dashboard has four panels: accepted rate, throttled rate, shaping failures and writer lag. The page-worthy alert is writer_lag_seconds above 90 for ten minutes. Throttled rate alone is not page-worthy; it only means clients are being told to slow down. Shaping failures above two percent of accepted events for a single tenant opens a ticket, not a page.

## On-call tips

Check writer lag before anything else; a receiver that looks sick is often just reporting a slow writer. Do not restart the shaper to clear its schema cache during peak hours, because every tenant then pays the cold-cache penalty at once. When in doubt, lower the fan-out limit one step rather than restarting anything. Write down every manual change in the handover thread.

## Odd behaviours worth knowing

Events whose timestamp is more than 7 minutes in the future are rejected as clock skew, not shaped. Events older than 31 days are accepted only through the slow lane. Two receivers can briefly accept the same event during an edge flip; the writer de-duplicates on the event id, so the duplicates are harmless but they do show up in the accepted rate.

## Partition ownership

Every partition has exactly one writer owner, recorded in the ownership table. A writer that loses its lease stops committing within two seconds and the partition is picked up by another writer after the lease timeout of twenty seconds. During that gap events queue in the receiver buffer, which holds about four minutes of a typical tenant's traffic. If the gap is longer than the buffer, the receiver starts to throttle that tenant, and that is how a writer incident turns into a customer-visible slowdown.

## Receiver buffer and spill

The receiver keeps a bounded in-memory buffer per tenant and spills to local disk when it is full. Spill files are read back in order once the writer recovers. A receiver that is restarted with spill files on disk replays them on boot, which can delay its readiness by a few minutes. Do not delete spill files by hand to speed up a restart; the events in them have already been acknowledged to the client.

## Ordering guarantees

Ordering is guaranteed within a partition and not across partitions. Tenants that need a strict order must choose a partition key that groups the related events. Support sometimes receives a complaint that two events arrived "out of order"; first check whether the events used different keys, because then the platform behaved exactly as documented.

## Compression and payload size

Payloads above one megabyte are rejected at the edge. Compressed batches are accepted up to eight megabytes after inflation. A client that sends one huge batch instead of many small ones will see throttling earlier than expected, since the limiter counts events, and a batch of ten thousand events consumes ten thousand tokens at once.

## Tenant onboarding

A new tenant starts on the default shard count and the default limits. Capacity planning asks for the expected peak event rate and the largest expected batch. If the expected peak is above half of the steady limit, plan the limit increase before the go-live date, not after the first throttling complaint. The sales engineer fills the capacity form, and the on-call reads it at handover.

## Capacity planning

The ingest fleet is sized for the sum of steady limits across tenants times an overcommit factor of 0.35, since tenants rarely peak together. The overcommit factor is reviewed every quarter against the observed ninety-ninth percentile of total accepted rate. If a quarter's peak comes within ten percent of fleet capacity, add writers before adding receivers: receivers are cheap and writers are the bottleneck.

## Post-incident habits

After any incident that touched the writer, write down the partition ids involved, the lag curve and what you changed. The next on-call will want to know whether the lag was still falling when you stopped looking. Link the notes in the handover thread and in the ticket.

## Replay etiquette

Replays into live partitions compete with real traffic. Replay through the slow lane whenever the volume is above fifty thousand events, and tell the tenant before you start, because they will see old events show up in their dashboards. After a replay, compare the count of replayed events with the count that arrived in the writer; a gap means some events failed shaping a fourth time and are back in the parking topic.

## Regional differences

The eu-west region runs with a lower default fan-out because its writers have fewer cores, so the default there is 8 rather than 16 and the raise rule is the same. The ap-south region has no slow lane of its own and borrows the eu-west one for backfills, which adds about forty milliseconds per batch.
